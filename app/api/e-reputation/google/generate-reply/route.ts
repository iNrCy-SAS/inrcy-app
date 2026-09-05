import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { enforceRateLimit } from "@/lib/rateLimit";
import { asRecord, asString } from "@/lib/tsSafe";
import { getGmbToken } from "@/lib/googleBusiness";
import { getGmbReviewTargetFromRow, isGmbReviewNameForParent } from "@/lib/googleBusinessReviews";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  buildAiLanguageInstruction,
  getAiEngineTemperature,
  buildAiWritingProfilePromptSection,
  buildAiWritingProfileRules,
} from "@/lib/aiWritingProfile";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { getAiProfessionalGenerationContext } from "@/lib/aiProfessionalGenerationContext";
import {
  commitAiCredits,
  computeReviewReplyAiCredits,
  reserveAiCredits,
  rollbackAiCredits,
  isAdminUserForAi,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";

export const maxDuration = 60;

type GeneratedReviewReply = {
  reply_text?: unknown;
  comment?: unknown;
};

const MAX_REVIEW_COMMENT_LENGTH = 2500;
const MAX_EXISTING_REPLY_LENGTH = 2500;
const MAX_REVIEWER_NAME_LENGTH = 120;
const MAX_REPLY_LENGTH = 4096;

function clean(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();
}

function cleanReply(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
    .trim()
    .slice(0, MAX_REPLY_LENGTH)
    .trim();
}

function normalizeRating(value: unknown) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return 0;
  return Math.min(5, Math.max(0, Math.round(rating)));
}

function listFrom(value: unknown, max = 8) {
  if (Array.isArray(value)) return value.map((item) => clean(item, 90)).filter(Boolean).slice(0, max);
  return clean(value, 700)
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickVariant<T>(variants: T[], seed: number) {
  if (!variants.length) return null;
  return variants[Math.abs(seed) % variants.length] || null;
}

function buildDisplaySignatureOptions(company: string, firstName: string, lastName: string) {
  const compactLastName = lastName ? `${lastName.charAt(0).toUpperCase()}.` : "";
  const options = [
    firstName ? `— ${firstName}` : "",
    firstName && compactLastName ? `— ${firstName} ${compactLastName}` : "",
    company ? `— L’équipe ${company}` : "",
    company ? `— ${company}` : "",
    "— L’équipe",
  ].map((value) => clean(value, 70)).filter(Boolean);

  return Array.from(new Set(options)).slice(0, 5);
}

export async function POST(req: Request) {
  let quotaReservation: AiCreditReservation | null = null;
  try {
    const { supabase, authUserId, activeUserId, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const body = asRecord(await req.json().catch(() => ({})) as unknown);
    const reviewName = clean(asString(body.reviewName), 260);
    const reviewerName = clean(body.reviewerName, MAX_REVIEWER_NAME_LENGTH) || "Client Google";
    const rating = normalizeRating(body.rating);
    const reviewComment = clean(body.comment, MAX_REVIEW_COMMENT_LENGTH);
    const existingReply = clean(body.existingReply, MAX_EXISTING_REPLY_LENGTH);

    if (!reviewName) {
      return NextResponse.json(
        { error: "Avis Google manquant.", user_message: "Avis Google manquant." },
        { status: 400 },
      );
    }

    const token = await getGmbToken();
    if (!token?.accessToken) {
      return NextResponse.json(
        { error: "Google Business n’est pas connecté.", user_message: "Google Business n’est pas connecté." },
        { status: 401 },
      );
    }

    const target = getGmbReviewTargetFromRow(token.row);
    if (!target.accountName || !target.locationName) {
      return NextResponse.json(
        {
          error: "Aucun établissement Google Business n’est sélectionné.",
          user_message: "Aucun établissement Google Business n’est sélectionné.",
        },
        { status: 400 },
      );
    }

    if (!isGmbReviewNameForParent(reviewName, target.accountName, target.locationName)) {
      return NextResponse.json(
        {
          error: "Cet avis ne correspond pas à l’établissement Google Business connecté.",
          user_message: "Cet avis ne correspond pas à l’établissement Google Business connecté.",
        },
        { status: 403 },
      );
    }

    const userId = activeUserId;
    const isAdmin = await isAdminUserForAi(supabase, authUserId);
    if (!isAdmin) {
      const rateLimited = await enforceRateLimit({
        name: "ereputation_review_reply_ai",
        identifier: authUserId,
        limit: 80,
        window: "1 d",
        failClosed: false,
      });
      if (rateLimited) return rateLimited;

      const quota = await reserveAiCredits({
        supabase,
        userId,
        action: "review_reply",
        credits: computeReviewReplyAiCredits({ rating, comment: reviewComment, existingReply }),
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
      idea: reviewComment || `Avis ${rating}/5`,
      theme: "google-review-reply",
      style: "review-reply",
    });
    const preferredEngine = generationProfile.preferences.engine;
    const businessContext = generationProfile.business;
    const profession = businessContext.professionLabel;
    const sectorLabel = businessContext.sectorLabel;
    const company = clean(businessContext.companyName, 160);
    const ownerFirstName = clean(profile["first_name"] || profile["firstname"] || profile["given_name"], 60);
    const ownerLastName = clean(profile["last_name"] || profile["lastname"] || profile["family_name"], 80);
    const city = clean(businessContext.city, 80);
    const activityDescription = clean(businessContext.description, 800);
    const services = listFrom(businessContext.services, 10);
    const strengths = listFrom(businessContext.strengths, 8);
    const aiConfig = buildAiWritingProfilePromptSection(generationProfile);
    const aiRules = buildAiWritingProfileRules(generationProfile, preferredEngine);
    const aiLanguageInstruction = buildAiLanguageInstruction(generationProfile);
    const variationSeed = stableHash([reviewName, reviewerName, rating, reviewComment, company].join("|"));
    const openingVariant = pickVariant([
      "remercier avec chaleur et naturel, sans formule copiée-collée",
      "mettre en avant la confiance accordée à l’entreprise",
      "valoriser sobrement l’expérience vécue par le client",
      "remercier de façon professionnelle avec une tournure différente des réponses habituelles",
    ], variationSeed) || "remercier avec naturel";
    const closingVariant = pickVariant([
      "terminer par une phrase simple et positive",
      "terminer par une ouverture au plaisir de revoir le client",
      "terminer par une formule rassurante et élégante",
      "terminer par une phrase courte qui valorise la relation client",
    ], variationSeed + 7) || "terminer positivement";
    const toneVariant = pickVariant([
      "ton humain et fluide",
      "ton professionnel et chaleureux",
      "ton sobre, rassurant et personnalisé",
      "ton naturel, sans langage robotique",
    ], variationSeed + 13) || "ton humain";
    const signatureOptions = buildDisplaySignatureOptions(company, ownerFirstName, ownerLastName);
    const signatureInstruction = signatureOptions.length
      ? `Tu peux ajouter une courte signature personnalisée seulement de temps en temps (environ une réponse sur trois maximum), par exemple : ${signatureOptions.join(" | ")}.`
      : "Tu peux ajouter une courte signature de temps en temps (par exemple : — L’équipe), mais jamais systématiquement.";

    const system = `Tu es l'assistant IA d'iNrCy spécialisé dans les réponses aux avis Google Business.
Réponds uniquement en JSON valide : {"reply_text":"..."}.
Objectif : proposer une réponse courte, humaine, professionnelle et prête à publier sur Google.
Règles strictes :
- Répondre au nom de l'entreprise, jamais au nom d'iNrCy.
- Ne jamais inventer de fait, prix, geste commercial, garantie, délai, certification ou promesse.
- Ne jamais divulguer d'information privée ou sensible.
- Si l'avis est négatif ou mitigé : rester calme, empathique, remercier, reconnaître le ressenti sans admettre une faute non établie, proposer un échange direct.
- Si l'avis est positif : remercier naturellement, valoriser l'équipe/le service sans surjouer.
- Si l'avis ne contient pas de commentaire écrit : produire une réponse simple adaptée à la note.
- Adapter clairement le ton selon la note : 5★ chaleureux et valorisant ; 4★ positif avec nuance ; 3★ neutre et ouvert ; 1–2★ empathique, calme et orienté résolution.
- Varier fortement les formulations d'un avis à l'autre : éviter les copier-coller et les ouvertures répétitives.
- Éviter si possible les phrases trop vues comme « Merci beaucoup pour votre excellente note » ou « Nous sommes ravis de savoir que notre service vous satisfait » si une formulation plus naturelle peut être proposée.
- Ajouter une courte signature personnalisée seulement de temps en temps, jamais systématiquement.
- Pas de markdown, pas de HTML, pas de hashtag, pas de formule lourde.
- Une réponse Google doit rester concise et proportionnée à l'avis. Ne force pas un nombre fixe de phrases : une réponse très courte peut suffire, une réponse négative peut nécessiter un peu plus de matière.
- Respecter la Configuration IA du professionnel quand elle est compatible avec une réponse d'avis Google.
${aiLanguageInstruction}
${aiRules}`;

    const input = `Entreprise : ${company || target.locationTitle || "Non précisée"}
Ville : ${city || "Non précisée"}
Secteur : ${sectorLabel || "Non précisé"}
Métier : ${profession || "Non précisé"}
Description activité : ${activityDescription || "Non précisée"}
Prestations : ${services.length ? services.join(", ") : "Non précisées"}
Forces : ${strengths.length ? strengths.join(", ") : "Non précisées"}
Fiche Google : ${target.locationTitle || "Fiche Google Business"}

Configuration IA :
${aiConfig || "- Non précisée"}

Instruction de langue prioritaire :
${aiLanguageInstruction}

Pistes facultatives anti-répétition pour cette réponse :
- Angle d’ouverture : ${openingVariant}
- Style attendu : ${toneVariant}
- Clôture : ${closingVariant}
- Signature : ${signatureInstruction}

Ces pistes sont des inspirations, pas un plan obligatoire. Si une autre construction naturelle convient mieux au moteur actif et à l'avis, utilise-la.

Avis Google à traiter :
- Auteur : ${reviewerName}
- Note : ${rating || "Non précisée"}/5
- Commentaire : ${reviewComment || "Avis sans commentaire écrit."}
${existingReply ? `\nRéponse actuelle à améliorer/modifier :\n${existingReply}\n` : ""}

Génère une seule réponse prête à publier, naturelle, rassurante et adaptée à la note. Ne recopie pas mot pour mot l'avis. Ne commence pas par le prénom si le nom semble incomplet ou anonymisé. Fais une réponse différente des formulations génériques habituelles lorsque c’est possible.`;

    const generated = await aiGenerateJSON<GeneratedReviewReply>({
      feature: "reviews.google",
      accountId: userId,
      engine: preferredEngine,
      system,
      input,
      maxOutputTokens: 700,
      temperature: getAiEngineTemperature(generationProfile, preferredEngine, "reply"),
    });

    const generatedReply = cleanReply(generated?.reply_text || generated?.comment);
    const replyText = generatedReply;

    if (!replyText) {
      await rollbackAiCredits(quotaReservation);
      return NextResponse.json(
        { error: "iNrCy n’a pas retourné de réponse exploitable.", user_message: "iNrCy n’a pas retourné de réponse exploitable." },
        { status: 500 },
      );
    }

    await commitAiCredits(quotaReservation);
    return NextResponse.json({
      ok: true,
      reviewName,
      reply_text: replyText,
    });
  } catch (error) {
    await rollbackAiCredits(quotaReservation);
    return jsonUserFacingError(error, {
      status: 500,
      fallback: "La génération IA n’a pas pu aboutir pour cet avis.",
    });
  }
}
