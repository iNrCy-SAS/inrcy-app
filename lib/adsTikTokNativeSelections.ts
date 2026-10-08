import { TIKTOK_ADS_IDENTITY_TYPES, TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, type TikTokAdsIdentity } from "./adsTikTokResources.ts";

/** Durable requested choices only. None of these fields is a capability or a native write grant. */
export type TikTokAdsNativeSelections = {
  schemaVersion: 1;
  advertiserId: string;
  context: typeof TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT;
  identity: Pick<TikTokAdsIdentity, "id" | "type" | "authorizedBusinessCenterId"> | null;
  locationIds: string[];
  callToAction: string | null;
  thumbnailMediaId: string | null;
  isAiGenerated: boolean | null;
};
export type TikTokAdsCompleteNativeSelections = TikTokAdsNativeSelections & {
  identity: NonNullable<TikTokAdsNativeSelections["identity"]>;
  callToAction: string; thumbnailMediaId: string; isAiGenerated: boolean;
};
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (row: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed) => Object.keys(row).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(row, key));
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const identityId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function normalizeTikTokAdsNativeSelections(value: unknown): { selections: TikTokAdsNativeSelections | null; error: string | null } {
  if (value == null) return { selections: null, error: null };
  const row = object(value);
  const invalid = { selections: null, error: "Vérifiez les choix natifs TikTok Ads du compte, de l’identité, des zones et du média." };
  if (!row || !exactKeys(row, ["schemaVersion", "advertiserId", "context", "identity", "locationIds", "callToAction", "thumbnailMediaId", "isAiGenerated"])
    || row.schemaVersion !== 1 || typeof row.advertiserId !== "string" || !/^\d{5,30}$/.test(row.advertiserId)) return invalid;
  const context = object(row.context);
  if (!context || !exactKeys(context, ["objectiveType", "placements", "language", "levelRange"])
    || context.objectiveType !== "TRAFFIC" || context.language !== "fr" || context.levelRange !== "TO_CITY"
    || !Array.isArray(context.placements) || context.placements.length !== 1 || context.placements[0] !== "PLACEMENT_TIKTOK") return invalid;
  let identity: TikTokAdsNativeSelections["identity"] = null;
  if (row.identity !== null) {
    const selected = object(row.identity);
    if (!selected || !exactKeys(selected, ["id", "type", "authorizedBusinessCenterId"], ["id", "type"])
      || !identityId(selected.id) || typeof selected.type !== "string" || !TIKTOK_ADS_IDENTITY_TYPES.some((type) => type === selected.type)
      || (Object.hasOwn(selected, "authorizedBusinessCenterId") && (typeof selected.authorizedBusinessCenterId !== "string" || !/^\d{5,30}$/.test(selected.authorizedBusinessCenterId)))
      || (selected.type === "BC_AUTH_TT" && !selected.authorizedBusinessCenterId)
      || (selected.type !== "BC_AUTH_TT" && Object.hasOwn(selected, "authorizedBusinessCenterId"))) return invalid;
    identity = { id: selected.id, type: selected.type as TikTokAdsIdentity["type"], ...(selected.authorizedBusinessCenterId ? { authorizedBusinessCenterId: selected.authorizedBusinessCenterId as string } : {}) };
  }
  if (!Array.isArray(row.locationIds) || row.locationIds.length > 20 || row.locationIds.some((id) => typeof id !== "string" || !/^\d{1,30}$/.test(id) || /^0+$/.test(id))
    || new Set(row.locationIds).size !== row.locationIds.length
    || (row.callToAction !== null && (typeof row.callToAction !== "string" || !/^[A-Z][A-Z_]{1,50}$/.test(row.callToAction)))
    || (row.thumbnailMediaId !== null && !uuid(row.thumbnailMediaId))
    || (row.isAiGenerated !== null && typeof row.isAiGenerated !== "boolean")) return invalid;
  return { selections: { schemaVersion: 1, advertiserId: row.advertiserId, context: structuredClone(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT), identity,
    locationIds: [...row.locationIds] as string[], callToAction: row.callToAction as string | null, thumbnailMediaId: row.thumbnailMediaId as string | null, isAiGenerated: row.isAiGenerated as boolean | null }, error: null };
}

export function tikTokAdsNativeSelectionsComplete(selections: TikTokAdsNativeSelections | null): selections is TikTokAdsCompleteNativeSelections {
  return Boolean(selections?.identity && selections.locationIds.length && selections.callToAction && selections.thumbnailMediaId && typeof selections.isAiGenerated === "boolean");
}
/** A stable public semantic key; list order and provider display labels are not grants. */
export function tikTokAdsNativeSelectionsKey(value: TikTokAdsNativeSelections | null): string | null {
  const parsed = normalizeTikTokAdsNativeSelections(value);
  if (!parsed.selections || parsed.error) return null;
  const selected = parsed.selections;
  return JSON.stringify({ ...selected, identity: selected.identity ? { id: selected.identity.id, type: selected.identity.type, authorizedBusinessCenterId: selected.identity.authorizedBusinessCenterId || null } : null,
    locationIds: [...selected.locationIds].sort() });
}

/** Public blocker codes stay stable; UI text contains no credential or provider error payload. */
export function tikTokAdsPreparationBlockerMessage(code: string): string {
  const messages: Record<string, string> = {
    native_capabilities_unverified: "Les droits natifs TikTok nécessaires restent à vérifier.",
    native_capability_snapshot_invalid: "Le contrôle des droits doit être renouvelé pour ce compte.",
    manualTrafficV13_unverified: "L’accès au format Traffic utilisé reste à confirmer.",
    nativeWriteAccess_unverified: "L’autorisation de créer des publicités reste à confirmer.",
    videoUpload_unverified: "L’autorisation d’importer la vidéo reste à confirmer.",
    imageUpload_unverified: "L’autorisation d’importer la vignette reste à confirmer.",
    mediaRead_unverified: "Le contrôle natif des médias reste à confirmer.",
    objectRead_unverified: "La lecture des publicités suspendues reste à confirmer.",
    cta_options_unverified: "Le bouton choisi doit être confirmé par TikTok pour ce format.",
    non_spark_identity_type_unverified: "La disponibilité de cette identité pour une vidéo non-Spark reste à confirmer.",
    identity_required: "Sélectionnez une identité TikTok autorisée.",
    identity_not_authorized: "L’identité choisie n’est plus autorisée pour ce compte.",
    identity_read_unavailable: "TikTok n’a pas confirmé la lecture des identités.",
    location_required: "Sélectionnez au moins une zone native TikTok.",
    location_not_available: "Une zone choisie n’est plus disponible pour ce compte et ce placement.",
    cta_required: "Choisissez le bouton de l’annonce.",
    thumbnail_required: "Préparez une vignette dans votre médiathèque.",
    aigc_declaration_required: "Confirmez si cette vidéo utilise un contenu généré par IA.",
    account_timezone_unverified: "Le fuseau du compte TikTok reste à confirmer.",
    budget_minimum_unverified: "Le minimum EUR de TikTok doit être confirmé pour ce calendrier.",
    minimum_budget_unverified: "Le minimum EUR de TikTok doit être confirmé pour ce calendrier.",
    minimum_budget_calendar_unverified: "Le minimum budgétaire doit être revérifié pour les dates choisies.",
    total_budget_below_native_minimum: "Le budget est inférieur au minimum natif confirmé de TikTok.",
    schedule_time_basis_unverified: "La convention horaire de l’API TikTok reste à confirmer.",
    schedule_offset_unverified: "Le décalage horaire fixe du compte reste à confirmer.",
    paused_creation_disabled: "La création suspendue TikTok n’est pas activée.",
    delivery_not_supported: "Utilisez un budget total et les enchères automatiques pour ce format.",
    draft_not_supported: "Ce parcours prend en charge une vidéo Traffic vers un site web sur TikTok.",
    additional_targeting_unsupported: "Les mots-clés ne sont pas pris en charge dans ce parcours vidéo.",
    ad_text_invalid: "Le texte de l’annonce doit contenir entre 1 et 100 caractères.",
    name_invalid: "Le nom doit contenir entre 3 et 100 caractères.",
    total_budget_invalid: "Vérifiez le budget total de ce premier parcours, limité à 500 €.",
    schedule_invalid: "Vérifiez les dates de début et de fin de la campagne.",
    destination_invalid: "Vérifiez l’adresse HTTPS de destination.",
    owned_media_required: "Choisissez la vidéo et sa vignette dans votre médiathèque.",
    owned_source_media_unavailable: "La vidéo et sa vignette doivent être actives, verticales et disponibles dans votre médiathèque.",
    source_media_read_unavailable: "Votre médiathèque n’a pas pu être contrôlée.",
    source_media_changed: "La vidéo ou sa vignette a changé depuis votre confirmation.",
    campaign_store_migration_required: "Le stockage sécurisé de reprise doit être mis à jour avant le contrôle natif TikTok.",
  };
  return messages[code] || "Une information native TikTok doit être revérifiée avant la création suspendue.";
}
