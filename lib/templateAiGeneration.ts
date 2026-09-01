import "server-only";

import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { createAiOperationBudget } from "@/lib/aiGatewayPolicy";
import { enforceRateLimit } from "@/lib/rateLimit";
import { asRecord } from "@/lib/tsSafe";
import { renderWithContext, buildDefaultContext } from "@/lib/templateEngine";
import { hasActiveInrcySite } from "@/lib/inrcySite";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import {
  buildAiLanguageInstruction,
  getAiEngineTemperature,
  buildAiWritingProfilePromptSection,
  buildAiWritingProfileRules,
} from "@/lib/aiWritingProfile";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { normalizeAiPreferredEngine } from "@/lib/aiEnginePreference";
import { parseMailAttachmentRefs } from "@/lib/mailAttachmentRefs";
import { buildMailAttachmentAiPromptSection } from "@/lib/aiAttachmentContext";
import {
  commitAiCredits,
  computeTemplateAiCredits,
  reserveAiCredits,
  rollbackAiCredits,
  isAdminUserForAi,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";

export type TemplateAiGenerationInput = Record<string, unknown>;

export type TemplateAiGenerationResult = {
  subject: string;
  body_text: string;
};

type GeneratedTemplateMail = Record<string, unknown> & {
  subject?: unknown;
  body_text?: unknown;
};

export class TemplateAiGenerationError extends Error {
  status: number;
  code?: string;
  headers?: Record<string, string>;

  constructor(message: string, opts: { status?: number; code?: string; headers?: Record<string, string> } = {}) {
    super(message);
    this.name = "TemplateAiGenerationError";
    this.status = opts.status ?? 500;
    this.code = opts.code;
    this.headers = opts.headers;
  }
}

const clean = (value: unknown, max = 600) => String(value ?? "").trim().slice(0, max);

function normalizeGeneratedMailText(value: string, max = 6000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, max);
}

const unfinishedMailPatterns = [
  /\{\{[^}]+\}\}/i,
  /\[[^\]]*(?:décrire|decrire|compléter|completer|ville|quartier|besoin|résultat|resultat|client|solution|secteur)[^\]]*\]/i,
  /\b(?:à compléter|a completer|non précisé(?:e)?|non precise(?:e)?|exemple local|lieu\s*\/\s*secteur|ville ou quartier|besoin traité|besoin traite|résultat\s*\/\s*bénéfice|resultat\s*\/\s*benefice|décrire la situation|decrire la situation|décrire les actions|decrire les actions)\b/i,
  /\b(?:exemple local|secteur|besoins?|solutions?|résultat|resultat)\s*:\s*(?:\[|à compléter|a completer|non précisé|non précise|non precise)/i,
];

function findUnfinishedMailFragment(subject: string, bodyText: string) {
  const text = `${subject}\n${bodyText}`;
  const match = unfinishedMailPatterns.find((pattern) => pattern.test(text));
  return match ? match.source : "";
}

function listFrom(value: unknown, max = 8) {
  if (Array.isArray(value)) return value.map((v) => clean(v, 80)).filter(Boolean).slice(0, max);
  return clean(value, 600)
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

async function throwTemplateAiErrorFromResponse(response: Response): Promise<never> {
  const payload = asRecord(await response.clone().json().catch(() => ({})) as unknown);
  const headers: Record<string, string> = {};
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) headers["Retry-After"] = retryAfter;

  throw new TemplateAiGenerationError(
    clean(payload.error, 600) || "La génération IA n’a pas pu aboutir.",
    {
      status: response.status || 500,
      code: clean(payload.code, 120) || undefined,
      headers: Object.keys(headers).length ? headers : undefined,
    },
  );
}

export async function generateTemplateAiContent(args: {
  supabase: any;
  userId: string;
  quotaUserId?: string;
  actorUserId?: string;
  input: TemplateAiGenerationInput;
  enforceUserLimits?: boolean;
  aiFeature?: "templates.generate" | "agent.campaign";
}): Promise<TemplateAiGenerationResult> {
  const body = asRecord(args.input);
  const supabase = args.supabase;
  const userId = clean(args.userId, 160);
  const quotaUserId = clean(args.quotaUserId || args.userId, 160);
  const actorUserId = clean(args.actorUserId || args.quotaUserId || args.userId, 160);
  const enforceUserLimits = args.enforceUserLimits !== false;
  let quotaReservation: AiCreditReservation | null = null;

  if (!supabase || !userId) {
    throw new TemplateAiGenerationError("Votre session a expiré. Merci de vous reconnecter.", {
      status: 401,
      code: "auth_required",
    });
  }

  const templateModule = clean(body["module"], 40) || "propulser";
  const mission = clean(body["mission"], 80) || "Email client";
  const templateTitle = clean(body["template_title"], 140);
  const templateCategory = clean(body["template_category"], 140);
  const currentSubject = clean(body["subject"], 220);
  const currentBody = clean(body["body"], 6000);
  const attachmentRefs = parseMailAttachmentRefs(body["attachments"]);
  const isAutomaticCampaign = body["automatic_campaign"] !== false;

  if (!currentSubject && !currentBody) {
    throw new TemplateAiGenerationError("Aucun modèle à reformuler.", { status: 400 });
  }

  const isAdmin = await isAdminUserForAi(supabase, actorUserId);

  if (enforceUserLimits && !isAdmin) {
    const rateLimited = await enforceRateLimit({
      name: "template_ai",
      identifier: quotaUserId,
      limit: 40,
      window: "1 d",
      failClosed: false,
    });
    if (rateLimited) await throwTemplateAiErrorFromResponse(rateLimited);

    const quota = await reserveAiCredits({
      supabase,
      userId: quotaUserId,
      action: "template",
      credits: computeTemplateAiCredits(attachmentRefs),
    });
    if (quota.errorResponse) await throwTemplateAiErrorFromResponse(quota.errorResponse);
    quotaReservation = quota.reservation;
  }

  const [profileRes, businessRes, inrcyCfgRes, proCfgRes, integrationsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("business_profiles").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("inrcy_site_configs").select("site_url").eq("user_id", userId).maybeSingle(),
    supabase.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle(),
    supabase
      .from("integrations")
      .select("provider,status,resource_id,resource_label")
      .eq("user_id", userId)
      .in("provider", ["google", "facebook"]),
  ]);

  const profile = asRecord(profileRes.data);
  const business = asRecord(businessRes.data);
  const generationProfile = buildNormalizedAiGenerationProfile({
    profile,
    business,
    idea: [mission, templateTitle].filter(Boolean).join(" — "),
    theme: templateModule,
    style: "campaign-email",
    media: {
      type: attachmentRefs.length ? "attachments" : "none",
      count: attachmentRefs.length,
      hasVisualContext: attachmentRefs.length > 0,
    },
  });
  const businessContext = generationProfile.business;
  const profession = businessContext.professionLabel;
  const sectorLabel = businessContext.sectorLabel;

  const ownership = String(profile["inrcy_site_ownership"] ?? "none");
  const inrcyUrl = clean(asRecord(inrcyCfgRes.data)["site_url"], 300);
  const proSettings = asRecord(asRecord(proCfgRes.data)["settings"]);
  const siteWebUrl = clean(asRecord(proSettings["site_web"])["url"], 300);
  const siteUrl = hasActiveInrcySite(ownership) && inrcyUrl ? inrcyUrl : siteWebUrl;

  let facebookUrl = "";
  let gmbUrl = "";
  for (const row0 of (integrationsRes.data ?? []) as unknown[]) {
    const row = asRecord(row0);
    if (row["provider"] === "facebook" && row["status"] === "connected" && row["resource_id"]) {
      facebookUrl = `https://www.facebook.com/${String(row["resource_id"])}`;
    }
    if (row["provider"] === "google" && row["status"] === "connected" && row["resource_id"]) {
      const gmbLabel = clean(row["resource_label"] || row["resource_id"], 160);
      gmbUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(gmbLabel)}`;
    }
  }

  const ctx = buildDefaultContext({
    profile,
    business,
    links: { site_url: siteUrl, facebook_url: facebookUrl, gmb_url: gmbUrl, review_url: gmbUrl || siteUrl },
  });

  const renderedSubject = normalizeMailSubject(renderWithContext(currentSubject, ctx));
  const renderedBody = stripTemplateSignatureBlock(renderWithContext(currentBody, ctx));

  const company = clean(businessContext.companyName, 160);
  const city = clean(businessContext.city, 80);
  const activityDescription = clean(businessContext.description, 800);
  const services = listFrom(businessContext.services, 10);
  const zones = listFrom(businessContext.interventionZones, 8);
  const strengths = listFrom(businessContext.strengths, 8);

  const preferredEngine = body["engine"]
    ? normalizeAiPreferredEngine(body["engine"])
    : generationProfile.preferences.engine;
  const aiConfig = buildAiWritingProfilePromptSection(generationProfile);
  const aiRules = buildAiWritingProfileRules(generationProfile, preferredEngine);
  const aiLanguageInstruction = buildAiLanguageInstruction(generationProfile);
  const attachmentContext = await buildMailAttachmentAiPromptSection(supabase, attachmentRefs, {
    userId,
    engine: preferredEngine,
  });

  const system = `Tu es le rédacteur IA d'iNrCy pour des emails professionnels. Tu réécris des modèles Propulser/Fidéliser.
Réponds uniquement en JSON valide : {"subject":"...","body_text":"..."}.
Objectif : produire un email original, naturel, utile, moins générique, sans changer la mission du modèle.
Règles strictes :
- Ne jamais inventer d'avis, de prix, de délai, de certification, de promotion ou de résultat.
- Conserver les liens, URL, mentions de lien avis, coordonnées et informations importantes déjà présentes.
- Si une pièce jointe est fournie, s’appuyer sur son contenu lisible pour rendre l’email plus précis.
- Ne jamais inventer le contenu d’une pièce jointe : si le texte n’est pas lisible, utiliser seulement le nom/type du fichier et rester prudent.
- Ne pas copier mot pour mot le modèle : reformuler vraiment l'objet et le message.
- Respecter strictement l'instruction de langue prioritaire : la langue du modèle, de la demande ou des pièces jointes ne doit pas changer la langue finale demandée.
- Ne pas changer la finalité : avis, recommandation, offre, information, suivi ou enquête selon le modèle.
- Garder un email prêt à envoyer, mais laisser le moteur choisir librement la construction. Salutation, CTA séparé et formule de fin ne sont pas obligatoires si la mission est plus naturelle sans l'un de ces éléments.
- Ne pas ajouter de markdown lourd ni de HTML. Texte brut uniquement.
- Ne jamais laisser de texte à compléter : aucun crochet [..], aucune variable {{..}}, aucun “Exemple local”, aucun “Secteur :”, aucun “Besoin :”, aucun “Résultat :” repris du modèle.
- Les modèles peuvent contenir des zones de travail. Tu dois les transformer en phrases complètes avec les informations disponibles, ou les supprimer proprement si l'information manque.
- Pour une campagne automatique iNr’Agent, le mail doit être prêt à valider, jamais prêt à compléter par le professionnel.
${aiLanguageInstruction}
${aiRules}`;

  const input = `Module : ${templateModule}
Mission : ${mission}
Modèle choisi : ${templateTitle || "Non précisé"}
Catégorie : ${templateCategory || "Non précisé"}

Entreprise : ${company || "Non précisée"}
Ville : ${city || "Non précisée"}
Secteur : ${sectorLabel || "Non précisé"}
Métier : ${profession || "Non précisé"}
Description activité : ${activityDescription || "Non précisée"}
Prestations : ${services.length ? services.join(", ") : "Non précisées"}
Zones : ${zones.length ? zones.join(", ") : "Non précisées"}
Forces : ${strengths.length ? strengths.join(", ") : "Non précisées"}

Configuration IA :
${aiConfig || "- Non précisée"}

Instruction de langue prioritaire :
${aiLanguageInstruction}

${attachmentContext ? `Contexte des pièces jointes :\n${attachmentContext}\n` : "Aucune pièce jointe à analyser."}

Objet actuel du modèle :
${renderedSubject}

Message actuel du modèle :
${renderedBody}

Réécris un nouvel objet et un nouveau message, plus personnalisé et plus naturel, en respectant la même mission. Si une pièce jointe utile est présente, exploite ses informations pour rendre le mail plus concret sans la recopier. Utilise les informations du profil seulement quand elles servent réellement le message. Laisse le moteur choisir librement le rythme, l'ouverture, les transitions et la conclusion : ne reproduis pas automatiquement la structure du modèle de départ. Ne renvoie jamais un modèle à compléter : remplace les exemples, crochets et libellés techniques par un email finalisé.`;

  const generationFeature = args.aiFeature || "templates.generate";
  const operationBudget = createAiOperationBudget(generationFeature);
  const generateOnce = (extraInstruction = "") => aiGenerateJSON<GeneratedTemplateMail>({
    feature: generationFeature,
    accountId: userId,
    budget: operationBudget,
    engine: preferredEngine,
    system,
    input: [input, extraInstruction].filter(Boolean).join("\n\n"),
    maxOutputTokens: 1300,
    temperature: getAiEngineTemperature(generationProfile, preferredEngine, "content"),
    retries: 1,
  });

  try {
    let generated = await generateOnce();
  let generatedSubject = normalizeMailSubject(normalizeGeneratedMailText(String(generated.subject || ""), 220));
  let generatedBody = stripTemplateSignatureBlock(normalizeGeneratedMailText(String(generated.body_text || ""), 6000));
  let unfinishedFragment = isAutomaticCampaign ? findUnfinishedMailFragment(generatedSubject, generatedBody) : "";

  if (!generatedSubject || generatedBody.length < 80 || unfinishedFragment) {
    generated = await generateOnce(
      `REPRISE OBLIGATOIRE : la réponse précédente était vide, incomplète ou contenait encore un morceau de modèle à compléter (${unfinishedFragment || "contenu incomplet"}). Retourne uniquement un JSON complet avec subject et body_text. Aucun crochet, aucune variable, aucun libellé “Exemple local / Secteur / Besoin / Résultat”, aucun markdown **...**. Le mail doit être finalisé et prêt à envoyer sans intervention du professionnel. Respecte strictement la langue finale demandée ci-dessus.`,
    );
    generatedSubject = normalizeMailSubject(normalizeGeneratedMailText(String(generated.subject || ""), 220));
    generatedBody = stripTemplateSignatureBlock(normalizeGeneratedMailText(String(generated.body_text || ""), 6000));
    unfinishedFragment = isAutomaticCampaign ? findUnfinishedMailFragment(generatedSubject, generatedBody) : "";
  }

  if (!generatedSubject || generatedBody.length < 80 || unfinishedFragment) {
    throw new TemplateAiGenerationError(
      "La génération IA n’a pas produit un email automatique suffisamment finalisé. Merci de réessayer.",
      { status: 502, code: "unfinished_automatic_campaign" },
    );
  }

    await commitAiCredits(quotaReservation);
    return { subject: generatedSubject, body_text: generatedBody };
  } catch (error) {
    await rollbackAiCredits(quotaReservation);
    throw error;
  }
}
