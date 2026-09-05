import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { enforceRateLimit } from "@/lib/rateLimit";
import { asRecord } from "@/lib/tsSafe";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import { buildAiLanguageInstruction, buildAiWritingProfilePromptSection, buildAiWritingProfileRules, getAiEngineTemperature } from "@/lib/aiWritingProfile";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { getAiProfessionalGenerationContext } from "@/lib/aiProfessionalGenerationContext";
import { parseMailAttachmentRefs } from "@/lib/mailAttachmentRefs";
import { buildMailAttachmentAiPromptSection } from "@/lib/aiAttachmentContext";
import {
  commitAiCredits,
  computeMailAiCredits,
  reserveAiCredits,
  rollbackAiCredits,
  isAdminUserForAi,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";

export const maxDuration = 60;

type GeneratedMail = {
  body_text?: unknown;
};


const MAIL_WRITING_TYPE_LABELS: Record<string, string> = {
  auto: "Automatique",
  presentation: "Présentation",
  prospection: "Prospection",
  relance: "Relance",
  thanks: "Remerciement",
  info: "Information",
  offer: "Offre commerciale",
  reply: "Réponse client",
  meeting: "Invitation / RDV",
};

function normalizeMailWritingType(value: unknown) {
  const key = String(value ?? "auto").trim();
  return MAIL_WRITING_TYPE_LABELS[key] ? key : "auto";
}

const clean = (value: unknown, max = 600) => String(value ?? "").trim().slice(0, max);

function listFrom(value: unknown, max = 8) {
  if (Array.isArray(value)) return value.map((v) => clean(v, 80)).filter(Boolean).slice(0, max);
  return clean(value, 600)
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

export async function POST(req: Request) {
  let quotaReservation: AiCreditReservation | null = null;
  try {
    const { supabase, authUserId, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const body = asRecord(await req.json().catch(() => ({})) as unknown);
    const subject = normalizeMailSubject(clean(body["subject"], 220));
    const currentBody = stripTemplateSignatureBlock(clean(body["body"], 4000));
    const writingTypeKey = normalizeMailWritingType(body["writingType"] ?? body["mailType"]);
    const writingTypeLabel = MAIL_WRITING_TYPE_LABELS[writingTypeKey] || MAIL_WRITING_TYPE_LABELS.auto;
    const attachmentRefs = parseMailAttachmentRefs(body["attachments"]);

    if (!subject.trim()) {
      return NextResponse.json({ error: "Renseignez d’abord un objet pour générer votre mail avec iNrCy." }, { status: 400 });
    }

    const userId = activeUserId;
    const isAdmin = await isAdminUserForAi(supabase, authUserId);

    if (!isAdmin) {
      const rateLimited = await enforceRateLimit({
        name: "mail_ai",
        identifier: authUserId,
        limit: 60,
        window: "1 d",
        failClosed: false,
      });
      if (rateLimited) return rateLimited;

      const quota = await reserveAiCredits({
        supabase,
        userId,
        action: "mail",
        credits: computeMailAiCredits(attachmentRefs),
      });
      if (quota.errorResponse) return quota.errorResponse;
      quotaReservation = quota.reservation;
    }

    const professionalContext = await getAiProfessionalGenerationContext({
      supabase,
      userId,
    });
    const profile = asRecord(professionalContext.profile);
    const business = asRecord(professionalContext.business);
    const generationProfile = buildNormalizedAiGenerationProfile({
      profile,
      business,
      idea: subject,
      theme: writingTypeKey,
      style: "mail",
      media: {
        type: attachmentRefs.length ? "attachments" : "none",
        count: attachmentRefs.length,
        hasVisualContext: attachmentRefs.length > 0,
      },
    });
    const preferredEngine = generationProfile.preferences.engine;
    const businessContext = generationProfile.business;
    const profession = businessContext.professionLabel;
    const sectorLabel = businessContext.sectorLabel;

    const company = clean(businessContext.companyName, 160);
    const city = clean(businessContext.city, 80);
    const activityDescription = clean(businessContext.description, 800);
    const services = listFrom(businessContext.services, 10);
    const zones = listFrom(businessContext.interventionZones, 8);
    const strengths = listFrom(businessContext.strengths, 8);

    const aiConfig = buildAiWritingProfilePromptSection(generationProfile);
    const aiRules = buildAiWritingProfileRules(generationProfile, preferredEngine);
    const aiLanguageInstruction = buildAiLanguageInstruction(generationProfile);
    const attachmentContext = await buildMailAttachmentAiPromptSection(supabase, attachmentRefs, {
      userId,
      engine: preferredEngine,
      maxFiles: 4,
      maxFileBytes: 8 * 1024 * 1024,
      maxTotalChars: 6500,
      maxCharsPerFile: 2200,
    });

    const system = `Tu es le rédacteur IA d'iNrCy pour des emails professionnels.
Réponds uniquement en JSON valide : {"body_text":"..."}.
Objectif : rédiger le corps d'un mail prêt à envoyer à partir de l'objet fourni.
Règles strictes :
- Ne modifie pas l'objet : il sert uniquement de sujet.
- Respecter le type d’écriture demandé. Si le type est "Automatique", déduire l'intention depuis l'objet.
- Ne jamais inventer d'avis, de prix, de délai, de certification, de promotion ou de résultat.
- Ne pas inclure de signature complète : l'application ajoute déjà la signature automatique.
- Garder un email naturel, utile, humain, clair et adapté à l'entreprise.
- Respecter la Configuration IA du professionnel, dont la langue de génération.
- Respecter strictement l'instruction de langue prioritaire : la langue de l'objet, du message actuel ou des pièces jointes ne doit pas changer la langue finale demandée.
- Si un message existe déjà, tu peux t'en inspirer sans le copier.
- Si des pièces jointes sont fournies, utiliser leurs informations uniquement si elles améliorent le message, sans les recopier mot pour mot.
- Ne jamais inventer le contenu d'une pièce jointe non lisible : dans ce cas, tenir compte seulement de son nom et de son type.
- Éviter les mots ou formes qui font spam : MAJUSCULES, promesses exagérées, urgence forcée, trop de points d'exclamation.
- Ne pas ajouter de markdown lourd ni de HTML. Texte brut uniquement.
${aiLanguageInstruction}
${aiRules}`;

    const input = `Objet du mail :
${subject}

Type d’écriture demandé : ${writingTypeLabel}

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

Contexte des pièces jointes, si présent :
${attachmentContext || "Aucune pièce jointe exploitable."}

Message actuel, si présent :
${currentBody || "Aucun"}

Rédige uniquement le corps du mail. L'objet doit rester inchangé. Choisis librement la meilleure construction : une salutation et une fin simple sont possibles mais pas obligatoires si le contexte appelle une forme plus directe.
Si le type d’écriture est précisé, adapte l'intention du message à ce type sans devenir artificiel.
Si des pièces jointes existent, les mentionner seulement quand cela aide le destinataire à comprendre le mail.`;

    const generated = await aiGenerateJSON<GeneratedMail>({
      feature: "mails.generate",
      accountId: userId,
      engine: preferredEngine,
      system,
      input,
      maxOutputTokens: 1100,
      temperature: getAiEngineTemperature(generationProfile, preferredEngine, "content"),
    });

    const bodyText = stripTemplateSignatureBlock(clean(generated.body_text, 5000));
    if (!bodyText) {
      await rollbackAiCredits(quotaReservation);
      return NextResponse.json({ error: "iNrCy n’a pas retourné de message exploitable." }, { status: 500 });
    }

    await commitAiCredits(quotaReservation);
    return NextResponse.json({ body_text: bodyText });
  } catch (error) {
    await rollbackAiCredits(quotaReservation);
    console.error("mails/generate-ai", error);
    return jsonUserFacingError(error, {
      status: 500,
      fallback: "La génération IA n’a pas pu aboutir.",
    });
  }
}
