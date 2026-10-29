import type { NormalizedAiGenerationProfile } from "./aiGenerationProfile.ts";

type ContentLocationProfile = Pick<NormalizedAiGenerationProfile, "business"> &
  Partial<Pick<NormalizedAiGenerationProfile, "memory">>;

function area(value: unknown) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
}

/** Editorial geography never replaces the business's physical address. */
export function resolveAiContentLocation(profile: ContentLocationProfile) {
  const preference = profile.memory?.contentLocation;
  // Missing settings retain each caller's historical geographic defaults.
  if (!preference || typeof preference.useHeadquarters !== "boolean") return undefined;
  const interventionAreas = Array.from(new Set((profile.business.interventionZones || []).map(area).filter(Boolean)));
  const primaryArea = preference.useHeadquarters
    ? area(profile.business.city)
    : area(preference.primaryArea) || interventionAreas[0] || "";
  return { useHeadquarters: preference.useHeadquarters, primaryArea, interventionAreas };
}

export function buildAiContentLocationInstruction(profile: ContentLocationProfile) {
  const location = resolveAiContentLocation(profile);
  if (!location) return "";
  const selection = location.useHeadquarters
    ? location.primaryArea
      ? `Ancrage géographique par défaut des contenus : lieu d'implantation « ${location.primaryArea} ».`
      : "Le lieu d'implantation n'est pas renseigné : n'invente aucune ville."
    : location.primaryArea
      ? `Zone commerciale principale des contenus : « ${location.primaryArea} ». Privilégie cette zone, pas la ville du siège, pour l'ancrage local et le SEO.`
      : "Aucune zone commerciale n'est renseignée : n'ajoute aucune ville par défaut et ne reviens pas à la ville du siège.";
  return [
    "LOCALISATION ÉDITORIALE :",
    selection,
    "Le sujet et la consigne ponctuelle restent prioritaires : conserve tout lieu explicitement demandé ou factuellement décrit, sans imposer une ville à chaque texte.",
    "Une zone commerciale n'est pas une adresse : ne prétends jamais que le siège y est implanté, n'y déplace pas l'entreprise et ne lui associe jamais le code postal du siège. Les coordonnées réelles servent uniquement lorsqu'elles sont demandées.",
  ].join(" ");
}

export function buildAiContentLocationPromptPayload(profile: ContentLocationProfile) {
  const location = resolveAiContentLocation(profile);
  if (!location) return undefined;
  return {
    source: location.useHeadquarters ? "lieu_implantation" : "zone_commerciale",
    zone_principale_contenus: location.primaryArea,
    regle: buildAiContentLocationInstruction(profile),
  };
}
