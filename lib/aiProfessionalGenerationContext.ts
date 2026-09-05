import "server-only";

import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { fitPromptPayloadToJsonBudget } from "./aiPromptBudget.ts";

export {
  getAiProfessionalGenerationContext,
  type AiProfessionalGenerationContext,
} from "@/lib/boosterGenerationContext";

function cleanText(value: unknown, maximum: number) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function cleanList(
  value: readonly string[] | undefined,
  maximumItems = 12,
  maximumLength = 140,
) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value || []) {
    const item = cleanText(raw, maximumLength).replace(/\s+/g, " ");
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maximumItems) break;
  }
  return result;
}

/**
 * Projection métier commune aux générateurs de texte. Elle complète le profil
 * rédactionnel sans exposer de données d'authentification ou de contact.
 */
export function buildAiProfessionalBusinessPromptPayload(
  profile: NormalizedAiGenerationProfile,
) {
  const business = profile.business;
  const payload = Object.fromEntries(
    Object.entries({
      entreprise: cleanText(business.companyName, 120),
      secteur: cleanText(business.sectorLabel, 120),
      metier: cleanText(business.professionLabel, 140),
      presentation: cleanText(business.description, 2_000),
      prestations: cleanList(business.services),
      zones_intervention: cleanList(business.interventionZones, 15),
      horaires: cleanText(business.openingHours, 1_000),
      forces: cleanList(business.strengths, 10),
      clienteles: cleanList(business.customerTypologies, 10, 120),
    }).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    ),
  );
  return fitPromptPayloadToJsonBudget(payload, 3_600);
}
