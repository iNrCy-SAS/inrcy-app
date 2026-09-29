export type MetaAdsLifecycleGraphJson = (
  userId: string,
  path: string,
  body?: URLSearchParams,
) => Promise<Record<string, unknown>>;

export type MetaAdsLifecycleResources = Record<string, unknown> & {
  campaignId?: unknown;
  adSetId?: unknown;
  adId?: unknown;
};

export type MetaAdsCampaignChanges = {
  name?: string;
  dailyBudgetCents?: number;
  endDate?: string;
  targetLocations?: string[];
};

export type MetaAdsLifecycleInput = {
  userId: string;
  adAccountId: string;
  resources: MetaAdsLifecycleResources;
};

export type MetaAdsCampaignUpdateInput = MetaAdsLifecycleInput & {
  changes: MetaAdsCampaignChanges;
};

export type MetaAdsLifecycleResult = {
  provider: "meta";
  state: "unchanged" | "active" | "paused" | "deleted";
  resources: MetaAdsLifecycleResources;
  applied: string[];
  normalizedChanges?: MetaAdsCampaignChanges;
};

export class MetaAdsLifecycleError extends Error {
  readonly operation: "update" | "pause" | "resume" | "delete";
  readonly applied: string[];
  readonly remoteMayHaveChanged: boolean;
  readonly campaignMayBeActive: boolean;

  constructor(input: {
    message: string;
    operation: "update" | "pause" | "resume" | "delete";
    applied?: string[];
    remoteMayHaveChanged?: boolean;
    campaignMayBeActive?: boolean;
  }) {
    super(input.message);
    this.name = "MetaAdsLifecycleError";
    this.operation = input.operation;
    this.applied = [...(input.applied || [])];
    this.remoteMayHaveChanged = input.remoteMayHaveChanged === true;
    this.campaignMayBeActive = input.campaignMayBeActive === true;
  }
}

type MetaGeoLocation = {
  countries?: string[];
  regions?: Array<{ key: string }>;
  cities?: Array<{ key: string }>;
  zips?: Array<{ key: string }>;
  location_types: ["home", "recent"];
};

type MetaGeoCandidate = {
  key: string;
  type: "country" | "region" | "city" | "zip";
  countryCode: string;
  name: string;
  region: string;
  countryName: string;
};

type MetaCampaignSnapshot = {
  state: MetaAdsLifecycleResult["state"];
};

function form(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredId(value: unknown, label: string): string {
  const id = String(value ?? "").trim();
  if (!/^\d{3,30}$/.test(id)) throw new Error(`L’identifiant Meta ${label} est invalide.`);
  return id;
}

function optionalId(value: unknown, label: string): string | null {
  const raw = String(value ?? "").trim();
  return raw ? requiredId(raw, label) : null;
}

function normalizedAccountId(value: unknown): string {
  return String(value ?? "").trim().replace(/^act_/, "");
}

function assertSameId(actual: unknown, expected: string, label: string): void {
  if (String(actual ?? "").trim() !== expected) {
    throw new Error(`Meta n’a pas confirmé l’appartenance de ${label} à cette campagne.`);
  }
}

function campaignStateFromSnapshot(snapshot: Record<string, unknown>): MetaAdsLifecycleResult["state"] {
  const status = String(snapshot.status ?? "").trim().toUpperCase();
  const effectiveStatus = String(snapshot.effective_status ?? snapshot.effectiveStatus ?? "").trim().toUpperCase();
  if (effectiveStatus === "DELETED" || status === "DELETED") return "deleted";
  if (effectiveStatus === "ACTIVE") return "active";
  if (["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED"].includes(effectiveStatus)) {
    return "paused";
  }
  if (status === "PAUSED" || status === "ARCHIVED") return "paused";
  if (status === "ACTIVE") return "active";
  return "unchanged";
}

async function readMetaCampaignSnapshot(
  userId: string,
  adAccountId: string,
  campaignId: string,
  graph: MetaAdsLifecycleGraphJson,
): Promise<MetaCampaignSnapshot> {
  const campaign = await graph(userId, `${campaignId}?fields=id,account_id,status,effective_status`);
  assertSameId(campaign.id, campaignId, "la campagne");
  if (normalizedAccountId(campaign.account_id) !== adAccountId) {
    throw new Error("Cette campagne Meta n’appartient pas au compte publicitaire associé.");
  }
  return { state: campaignStateFromSnapshot(campaign) };
}

/** Ensure every persisted Meta resource belongs to the selected advertiser hierarchy before writing. */
export async function assertMetaAdsResourceHierarchy(
  input: MetaAdsLifecycleInput,
  graph: MetaAdsLifecycleGraphJson,
): Promise<MetaCampaignSnapshot> {
  const adAccountId = requiredId(input.adAccountId, "de compte publicitaire");
  const campaignId = requiredId(input.resources.campaignId, "de campagne");
  const adSetId = optionalId(input.resources.adSetId, "d’ensemble publicitaire");
  const adId = optionalId(input.resources.adId, "d’annonce");

  const [campaignSnapshot, adSet, ad] = await Promise.all([
    readMetaCampaignSnapshot(input.userId, adAccountId, campaignId, graph),
    adSetId
      ? graph(input.userId, `${adSetId}?fields=id,account_id,campaign_id`)
      : Promise.resolve(null),
    adId
      ? graph(input.userId, `${adId}?fields=id,account_id,campaign_id,adset_id`)
      : Promise.resolve(null),
  ]);

  if (adSetId && adSet) {
    assertSameId(adSet.id, adSetId, "l’ensemble publicitaire");
    if (normalizedAccountId(adSet.account_id) !== adAccountId || String(adSet.campaign_id ?? "").trim() !== campaignId) {
      throw new Error("L’ensemble publicitaire Meta n’appartient pas à la campagne et au compte associés.");
    }
  }
  if (adId && ad) {
    assertSameId(ad.id, adId, "l’annonce");
    const wrongHierarchy = normalizedAccountId(ad.account_id) !== adAccountId
      || String(ad.campaign_id ?? "").trim() !== campaignId
      || (adSetId !== null && String(ad.adset_id ?? "").trim() !== adSetId);
    if (wrongHierarchy) {
      throw new Error("L’annonce Meta n’appartient pas à la campagne, à l’ensemble et au compte associés.");
    }
  }
  return campaignSnapshot;
}

function requireMetaSuccess(response: Record<string, unknown>, label: string): void {
  if (response.success !== true) throw new Error(`Meta n’a pas confirmé ${label}.`);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLocationQuery(value: string): string {
  return normalizeText(value)
    .replace(/^(?:et\s+)?(?:dans\s+)?(?:toute?\s+)?(?:la\s+|le\s+|les\s+)?/, "")
    .trim();
}

function candidateFrom(value: unknown): MetaGeoCandidate | null {
  const row = asRecord(value);
  const type = String(row.type || "").toLowerCase();
  if (type !== "country" && type !== "region" && type !== "city" && type !== "zip") return null;
  const key = String(row.key || "").trim();
  const countryCode = String(row.country_code || row.countryCode || "").trim().toUpperCase();
  if (!key || countryCode !== "FR") return null;
  return {
    key,
    type,
    countryCode,
    name: String(row.name || "").trim(),
    region: String(row.region || "").trim(),
    countryName: String(row.country_name || row.countryName || "").trim(),
  };
}

function candidateScore(candidate: MetaGeoCandidate, requested: string): number {
  const query = normalizeLocationQuery(requested);
  const name = normalizeText(candidate.name);
  const region = normalizeText(candidate.region);
  const country = normalizeText(candidate.countryName);
  const canonical = [name, region, country].filter(Boolean).join(" ");
  if (!query || !canonical) return -1;
  let score = 0;
  if (name === query) score += 200;
  else if (canonical === query) score += 180;
  else if (canonical.startsWith(`${query} `)) score += 120;
  else if (canonical.includes(query)) score += 80;
  else {
    const tokens = query.split(" ").filter((token) => token.length > 1);
    if (!tokens.length || !tokens.every((token) => canonical.includes(token))) return -1;
    score += 50 + tokens.length;
  }
  // Prefer the most precise common location when Meta returns homonyms.
  score += { city: 4, zip: 3, region: 2, country: 1 }[candidate.type];
  return score;
}

function franceOnlyLocations(): MetaGeoLocation {
  return { countries: ["FR"], location_types: ["home", "recent"] };
}

function isFranceRequest(value: string): boolean {
  const query = normalizeLocationQuery(value);
  return query === "france" || query === "fr" || query === "toute france";
}

/** Resolve the user's labels before any write, then build Meta's geo target. */
export async function resolveMetaAdsTargetLocations(
  userId: string,
  targetLocations: string[],
  graph: MetaAdsLifecycleGraphJson,
): Promise<MetaGeoLocation> {
  const requested = targetLocations.map((value) => String(value || "").trim()).filter(Boolean);
  if (!requested.length || requested.length > 20 || requested.some((value) => value.length > 120)) {
    throw new Error("Ajoutez entre 1 et 20 zones Meta valides.");
  }
  if (requested.some(isFranceRequest)) return franceOnlyLocations();

  const resolved: MetaGeoCandidate[] = [];
  for (const location of requested) {
    const params = new URLSearchParams({
      type: "adgeolocation",
      q: location,
      country_code: "FR",
      location_types: JSON.stringify(["country", "region", "city", "zip"]),
      limit: "50",
    });
    const response = await graph(userId, `search?${params.toString()}`);
    const scoredMatches = (Array.isArray(response.data) ? response.data : [])
      .map(candidateFrom)
      .filter((candidate): candidate is MetaGeoCandidate => Boolean(candidate))
      .map((candidate) => ({ candidate, score: candidateScore(candidate, location) }))
      .filter((entry) => entry.score >= 0);
    const uniqueMatches = new Map<string, (typeof scoredMatches)[number]>();
    for (const match of scoredMatches) {
      const key = `${match.candidate.type}:${match.candidate.key}`;
      const previous = uniqueMatches.get(key);
      if (!previous || match.score > previous.score) uniqueMatches.set(key, match);
    }
    const matches = [...uniqueMatches.values()].sort((left, right) => right.score - left.score);
    if (!matches.length) {
      throw new Error(`Meta ne reconnaît pas précisément la zone « ${location} ». Utilisez une ville, une région ou un code postal français.`);
    }
    if (matches.length > 1 && matches[0].score === matches[1].score) {
      throw new Error(`Meta trouve plusieurs zones équivalentes pour « ${location} ». Précisez la région ou le code postal.`);
    }
    resolved.push(matches[0].candidate);
  }

  if (resolved.some((location) => location.type === "country")) return franceOnlyLocations();
  const unique = (type: MetaGeoCandidate["type"]) => [...new Set(
    resolved.filter((location) => location.type === type).map((location) => location.key),
  )].map((key) => ({ key }));
  const regions = unique("region");
  const cities = unique("city");
  const zips = unique("zip");
  return {
    ...(regions.length ? { regions } : {}),
    ...(cities.length ? { cities } : {}),
    ...(zips.length ? { zips } : {}),
    location_types: ["home", "recent"],
  };
}

/** Meta expects an ISO-8601 offset and accepts an ad-set end in Paris time. */
export function metaAdsEndTimeFromDate(endDate: string, now = Date.now()): string {
  const reference = new Date(`${endDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(reference.getTime()) || reference.toISOString().slice(0, 10) !== endDate) {
    throw new Error("La date de fin Meta est invalide.");
  }
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  }).formatToParts(reference).find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offset) throw new Error("Impossible de déterminer le fuseau horaire de la campagne Meta.");
  const endTime = `${endDate}T23:59:59${offset[1]}${offset[2].padStart(2, "0")}:${offset[3] ?? "00"}`;
  const parisTodayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(
    parisTodayParts.find((entry) => entry.type === type)?.value,
  );
  const todayOrdinal = Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
  const [year, month, day] = endDate.split("-").map(Number);
  const endOrdinal = Date.UTC(year, month - 1, day) / 86_400_000;
  const daysUntilEnd = endOrdinal - todayOrdinal;
  if (daysUntilEnd < 1 || daysUntilEnd > 90) {
    throw new Error("La fin de campagne Meta doit être comprise entre demain et dans 90 jours.");
  }
  return endTime;
}

function normalizeChanges(changes: MetaAdsCampaignChanges): MetaAdsCampaignChanges {
  const normalized: MetaAdsCampaignChanges = {};
  if (Object.hasOwn(changes, "name")) {
    const name = String(changes.name || "").trim();
    if (name.length < 3 || name.length > 120) throw new Error("Le nom Meta doit contenir entre 3 et 120 caractères.");
    normalized.name = name;
  }
  if (Object.hasOwn(changes, "dailyBudgetCents")) {
    const budget = Number(changes.dailyBudgetCents);
    if (!Number.isInteger(budget) || budget < 500 || budget > 50_000) {
      throw new Error("Le budget Meta doit être compris entre 5 et 500 € par jour.");
    }
    normalized.dailyBudgetCents = budget;
  }
  if (Object.hasOwn(changes, "endDate")) {
    const endDate = String(changes.endDate || "").trim();
    metaAdsEndTimeFromDate(endDate);
    normalized.endDate = endDate;
  }
  if (Object.hasOwn(changes, "targetLocations")) {
    if (!Array.isArray(changes.targetLocations)) throw new Error("Les zones Meta sont invalides.");
    normalized.targetLocations = changes.targetLocations.map((value) => String(value || "").trim()).filter(Boolean);
    if (!normalized.targetLocations.length || normalized.targetLocations.length > 20 || normalized.targetLocations.some((value) => value.length > 120)) {
      throw new Error("Ajoutez entre 1 et 20 zones Meta valides.");
    }
  }
  if (!Object.keys(normalized).length) throw new Error("Aucune modification Meta n’a été demandée.");
  return normalized;
}

export async function executeMetaAdsCampaignUpdate(
  input: MetaAdsCampaignUpdateInput,
  graph: MetaAdsLifecycleGraphJson,
): Promise<MetaAdsLifecycleResult> {
  const campaignId = requiredId(input.resources.campaignId, "de campagne");
  const changes = normalizeChanges(input.changes);
  const applied: string[] = [];
  let mutationAttempted = false;
  let adSetBody: URLSearchParams | null = null;

  try {
    await assertMetaAdsResourceHierarchy(input, graph);
    if (Object.hasOwn(changes, "dailyBudgetCents") || Object.hasOwn(changes, "endDate") || Object.hasOwn(changes, "targetLocations")) {
      const adSetId = requiredId(input.resources.adSetId, "d’ensemble publicitaire");
      const fields: Record<string, string> = {};
      if (changes.dailyBudgetCents !== undefined) fields.daily_budget = String(changes.dailyBudgetCents);
      if (changes.endDate) fields.end_time = metaAdsEndTimeFromDate(changes.endDate);
      if (changes.targetLocations) {
        const [geoLocations, adSet] = await Promise.all([
          resolveMetaAdsTargetLocations(input.userId, changes.targetLocations, graph),
          graph(input.userId, `${adSetId}?fields=targeting`),
        ]);
        const targeting = asRecord(adSet.targeting);
        if (!Object.keys(targeting).length) {
          throw new Error("Meta n’a pas renvoyé le ciblage actuel de l’ensemble publicitaire.");
        }
        fields.targeting = JSON.stringify({ ...targeting, geo_locations: geoLocations });
      }
      adSetBody = form(fields);
    }

    if (changes.name) {
      mutationAttempted = true;
      requireMetaSuccess(await graph(input.userId, campaignId, form({ name: changes.name })), "la modification du nom de campagne");
      applied.push("campaign.name");
    }
    if (adSetBody) {
      const adSetId = requiredId(input.resources.adSetId, "d’ensemble publicitaire");
      mutationAttempted = true;
      requireMetaSuccess(await graph(input.userId, adSetId, adSetBody), "la modification de l’ensemble publicitaire");
      applied.push("adset.settings");
    }

    const current = await readMetaCampaignSnapshot(input.userId, input.adAccountId, campaignId, graph);

    return {
      provider: "meta",
      state: current.state,
      resources: input.resources,
      applied,
      normalizedChanges: changes,
    };
  } catch (error) {
    if (error instanceof MetaAdsLifecycleError) throw error;
    const reconciliation = mutationAttempted
      ? "Certaines données ont peut-être été modifiées : actualisez Meta Ads Manager avant de réessayer."
      : "Aucune modification n’a été envoyée à Meta.";
    throw new MetaAdsLifecycleError({
      operation: "update",
      applied,
      remoteMayHaveChanged: mutationAttempted,
      message: `${errorMessage(error, "Échec de la modification Meta Ads.")} ${reconciliation}`,
    });
  }
}

export async function executeMetaAdsCampaignPause(
  input: MetaAdsLifecycleInput,
  graph: MetaAdsLifecycleGraphJson,
): Promise<MetaAdsLifecycleResult> {
  const campaignId = requiredId(input.resources.campaignId, "de campagne");
  let mutationAttempted = false;
  try {
    await assertMetaAdsResourceHierarchy(input, graph);
    mutationAttempted = true;
    requireMetaSuccess(await graph(input.userId, campaignId, form({ status: "PAUSED" })), "la mise en pause de la campagne");
    return { provider: "meta", state: "paused", resources: input.resources, applied: ["campaign.status"] };
  } catch (error) {
    throw new MetaAdsLifecycleError({
      operation: "pause",
      remoteMayHaveChanged: mutationAttempted,
      campaignMayBeActive: mutationAttempted,
      message: `${errorMessage(error, "Échec de la mise en pause Meta Ads.")} ${mutationAttempted ? "Vérifiez immédiatement son statut dans Meta Ads Manager." : "Aucune modification n’a été envoyée à Meta."}`,
    });
  }
}

export async function executeMetaAdsCampaignResume(
  input: MetaAdsLifecycleInput,
  graph: MetaAdsLifecycleGraphJson,
): Promise<MetaAdsLifecycleResult> {
  const campaignId = requiredId(input.resources.campaignId, "de campagne");
  const adSetId = requiredId(input.resources.adSetId, "d’ensemble publicitaire");
  const adId = requiredId(input.resources.adId, "d’annonce");
  const applied: string[] = [];
  let mutationAttempted = false;
  let campaignMayBeActive = false;
  try {
    await assertMetaAdsResourceHierarchy(input, graph);
    mutationAttempted = true;
    requireMetaSuccess(await graph(input.userId, adId, form({ status: "ACTIVE" })), "la reprise de l’annonce");
    applied.push("ad.status");
    requireMetaSuccess(await graph(input.userId, adSetId, form({ status: "ACTIVE" })), "la reprise de l’ensemble publicitaire");
    applied.push("adset.status");
    campaignMayBeActive = true;
    requireMetaSuccess(await graph(input.userId, campaignId, form({ status: "ACTIVE" })), "la reprise de la campagne");
    applied.push("campaign.status");
    campaignMayBeActive = false;
    return { provider: "meta", state: "active", resources: input.resources, applied };
  } catch (error) {
    if (mutationAttempted) {
      try {
        requireMetaSuccess(await graph(input.userId, campaignId, form({ status: "PAUSED" })), "la mise en pause de secours");
        campaignMayBeActive = false;
      } catch {
        campaignMayBeActive = true;
      }
    }
    throw new MetaAdsLifecycleError({
      operation: "resume",
      applied,
      remoteMayHaveChanged: mutationAttempted,
      campaignMayBeActive,
      message: `${errorMessage(error, "Échec de la reprise Meta Ads.")} ${!mutationAttempted ? "Aucune modification n’a été envoyée à Meta." : campaignMayBeActive ? "La campagne pourrait être active : vérifiez-la immédiatement dans Meta Ads Manager." : "La campagne a été maintenue en pause par sécurité."}`,
    });
  }
}

export async function executeMetaAdsCampaignDelete(
  input: MetaAdsLifecycleInput,
  graph: MetaAdsLifecycleGraphJson,
): Promise<MetaAdsLifecycleResult> {
  const campaignId = requiredId(input.resources.campaignId, "de campagne");
  let mutationAttempted = false;
  try {
    await assertMetaAdsResourceHierarchy(input, graph);
    // Meta exposes deletion through the campaign status. This removes it from
    // normal delivery while retaining Meta's audit history.
    mutationAttempted = true;
    requireMetaSuccess(await graph(input.userId, campaignId, form({ status: "DELETED" })), "la suppression de la campagne");
    return { provider: "meta", state: "deleted", resources: input.resources, applied: ["campaign.status"] };
  } catch (error) {
    throw new MetaAdsLifecycleError({
      operation: "delete",
      remoteMayHaveChanged: mutationAttempted,
      message: `${errorMessage(error, "Échec de la suppression Meta Ads.")} ${mutationAttempted ? "Vérifiez Meta Ads Manager avant de relancer la suppression." : "Aucune modification n’a été envoyée à Meta."}`,
    });
  }
}
