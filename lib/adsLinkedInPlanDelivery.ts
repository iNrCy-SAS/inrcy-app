import { defaultLinkedInDeliverySettings, linkedInDeliveryBidding, normalizeLinkedInDeliverySettings, type LinkedInDeliverySettings } from "./adsLinkedInCampaignSettings.ts";

export type LinkedInDeliverySuggestion = {
  locationType: LinkedInDeliverySettings["locationType"];
  budget: Pick<LinkedInDeliverySettings["budget"], "startAt" | "endAt">;
  placements: LinkedInDeliverySettings["placements"];
  bidding: LinkedInDeliverySettings["bidding"];
};
export type LinkedInPlanDeliveryContext = { intent?: string; now?: string; timezone?: string; objectiveType?: string; format?: string };
type HumanDelivery = { locationType?: LinkedInDeliverySuggestion["locationType"]; budget: Partial<LinkedInDeliverySuggestion["budget"]>; placements: Partial<LinkedInDeliverySuggestion["placements"]>; bidding: Partial<LinkedInDeliverySuggestion["bidding"]> };
function key(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’]/g, "'"); }
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function validKeys(value: Record<string, unknown>, allowed: readonly string[]) { return Object.keys(value).every((name) => allowed.includes(name)); }
function positive(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].filter((match) => !/\b(?:pas|sans|aucun\w*|exclu\w*)\b[^,;.!?]{0,35}$/.test(text.slice(Math.max(0, match.index! - 45), match.index)));
}
function isoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || Number(match[7] || 0) > 23 || Number(match[8] || 0) > 59) return null;
  const calendar = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const millis = Date.parse(value);
  return Number.isSafeInteger(millis) && millis > 0 ? new Date(millis).toISOString() : null;
}

const MONTHS: Record<string, number> = { janvier: 1, janv: 1, fevrier: 2, fevr: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12 };
const MONTH_PATTERN = Object.keys(MONTHS).join("|");
const HUMAN_DATE = `(\\d{1,2})(?:er)?(?:\\s+(${MONTH_PATTERN})\\.?|[/-](\\d{1,2}))(?:[ /-]+(\\d{4}))?(?:\\s+(?:a\\s+)?(\\d{1,2})(?::|h)(\\d{2})?)?`;

/** Validate wall-clock dates with the IANA zone, including DST gaps/ambiguities. */
function zonedInstant(parts: number[], timezone: string): string | null {
  const [year, month, day, hour, minute] = parts;
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(target);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const localValue = (millis: number) => {
    const values = Object.fromEntries(format.formatToParts(millis).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
  };
  let millis = target;
  for (let index = 0; index < 4; index++) millis += target - localValue(millis);
  if (localValue(millis) !== target) return null;
  if ([-7_200_000, -3_600_000, 3_600_000, 7_200_000].some((shift) => localValue(millis + shift) === target)) return null;
  return new Date(millis).toISOString();
}

function readDates(text: string, context: LinkedInPlanDeliveryContext) {
  const budget: Partial<LinkedInDeliverySuggestion["budget"]> = {};
  const timezone = /\b(?:heure|fuseau)\s+(?:de\s+)?paris\b/.test(text) ? "Europe/Paris" : /\b(?:heure|fuseau)\s+utc\b/.test(text) ? "UTC" : context.timezone || "Europe/Paris";
  let year: number | null = null;
  try {
    if (context.now && isoInstant(context.now)) year = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric" }).format(Date.parse(context.now)));
  } catch { return { budget, error: "Précisez un fuseau horaire valide pour la diffusion LinkedIn." }; }
  for (const [field, marker, defaultHour, defaultMinute] of [
    ["startAt", "(?:du|a partir du|debut(?: de diffusion)?(?: le)?)", 0, 0],
    ["endAt", "(?:au|jusqu'au|fin(?: de diffusion)?(?: le)?)", 23, 59],
  ] as const) {
    const found = positive(text, new RegExp(`\\b${marker}\\s+${HUMAN_DATE}\\b`, "g"));
    const values: string[] = [];
    for (const match of found) {
      const calendarYear = match[4] ? Number(match[4]) : year;
      if (calendarYear === null) return { budget, error: "Précisez l’année des dates de diffusion LinkedIn." };
      let instant: string | null;
      try { instant = zonedInstant([calendarYear, match[2] ? MONTHS[match[2]] : Number(match[3]), Number(match[1]), match[5] ? Number(match[5]) : defaultHour, match[6] ? Number(match[6]) : defaultMinute], timezone); }
      catch { instant = null; }
      if (!instant) return { budget, error: "Vérifiez les dates et heures demandées pour LinkedIn ; une heure ambiguë nécessite un décalage UTC explicite." };
      values.push(instant);
    }
    // Explicit ISO dates keep the user's offset instead of assuming Paris.
    const isoDates = positive(text, new RegExp(`\\b${marker}\\s+(\\d{4}-\\d{2}-\\d{2}t\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:z|[+-]\\d{2}:\\d{2}))`, "g"));
    for (const match of isoDates) {
      const canonical = match[1].toUpperCase().replace(/(T\d{2}:\d{2})(?=Z|[+-])/, "$1:00");
      const instant = isoInstant(canonical);
      if (!instant) return { budget, error: "Vérifiez les dates ISO demandées pour la diffusion LinkedIn." };
      values.push(instant);
    }
    if (new Set(values).size > 1) return { budget, error: "Votre brief indique plusieurs dates de diffusion LinkedIn contradictoires." };
    if (values.length) budget[field] = values[0];
  }
  if (/\b(?:des maintenant|immediatement|des la validation)\b/.test(text)) {
    if (budget.startAt) return { budget, error: "Choisissez un début immédiat ou une date de début LinkedIn." };
    budget.startAt = null;
  }
  return { budget, error: null };
}

/** Human delivery constraints are labels/times only, never advertising resources. */
export function readLinkedInHumanDeliveryConstraints(context: LinkedInPlanDeliveryContext): { constraints: HumanDelivery; error: string | null } {
  const text = key(context.intent || "");
  const dates = readDates(text, context);
  const constraints: HumanDelivery = { budget: dates.budget, placements: {}, bidding: {} };
  if (dates.error) return { constraints, error: dates.error };
  if (positive(text, /\b(?:residence|localisation)\s+(?:ou\s+presence\s+)?recente\b|\bresidence\s+permanente\s+ou\s+(?:presence\s+)?recente\b/g).length) constraints.locationType = "recent_or_permanent";
  else if (positive(text, /\b(?:residence|localisation)\s+permanente\b|\bprofilelocations\b/g).length) constraints.locationType = "permanent";
  for (const [field, term] of [["audienceNetwork", "(?:audience network|reseau (?:de sites )?partenaires|sites partenaires)"], ["audienceExpansion", "(?:extension d'audience|elargissement d'audience|audience expansion)"]] as const) {
    if (new RegExp(`\\b(?:sans|pas de|desactiv\\w*)\\s+(?:l[' ]|le |les |la )?${term}\\b|\\b${term}\\s+desactiv\\w*\\b`).test(text)) constraints.placements[field] = false;
    else if (new RegExp(`\\b(?:activ\\w*|autoris\\w*)\\s+(?:l[' ]|le |les |la )?${term}\\b|\\b${term}\\s+(?:activ\\w*|autoris\\w*)\\b`).test(text)) constraints.placements[field] = true;
  }
  if (/\blinkedin uniquement\b|\buniquement (?:sur )?linkedin\b/.test(text)) constraints.placements.audienceNetwork = false;
  const strategies = [
    ...(positive(text, /\b(?:cpc manuel|encheres? manuelles?|manual_cpc)\b/g).length ? ["manual_cpc" as const] : []),
    ...(positive(text, /\b(?:diffusion maximale|maximiser la diffusion|maximum_delivery|automax|encheres? automatiques?)\b/g).length ? ["maximum_delivery" as const] : []),
    ...(positive(text, /\b(?:cout cible(?: moyen)?|cost_cap|cost cap)\b/g).length ? ["cost_cap" as const] : []),
  ];
  if (strategies.length > 1) return { constraints, error: "Choisissez une seule stratégie d’enchères LinkedIn." };
  if (strategies.length) constraints.bidding.strategy = strategies[0];
  const amounts = positive(text, /\b(?:cpc manuel|enchere manuelle|cout cible(?: moyen)?|cost cap)\s*(?:de|a|:)?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?\b|eur\b)/g);
  const money = [...new Set(amounts.map((match) => Number(match[1].replace(",", "."))))];
  if (money.length > 1) return { constraints, error: "Votre brief indique plusieurs enchères LinkedIn contradictoires." };
  if (money.length) constraints.bidding.amountEuros = money[0];
  return { constraints, error: null };
}

/** Native validation supplies calendar, cents and bidding/objective rules; bad choices never disappear. */
export function normalizeLinkedInDeliverySuggestion(value: unknown, context: LinkedInPlanDeliveryContext): { suggestion: LinkedInDeliverySuggestion | null; error: string | null } {
  const fail = (error: string) => ({ suggestion: null, error });
  const human = readLinkedInHumanDeliveryConstraints(context);
  if (human.error) return fail(human.error);
  const raw = value === undefined ? {} : object(value);
  if (!raw || !validKeys(raw, ["locationType", "budget", "placements", "bidding"])) return fail("Les conseils de diffusion LinkedIn sont invalides.");
  const budget = raw.budget === undefined ? {} : object(raw.budget), placements = raw.placements === undefined ? {} : object(raw.placements), bidding = raw.bidding === undefined ? {} : object(raw.bidding);
  if (!budget || !placements || !bidding || !validKeys(budget, ["startAt", "endAt"]) || !validKeys(placements, ["audienceNetwork", "audienceExpansion"]) || !validKeys(bidding, ["strategy", "amountEuros"])) return fail("Vérifiez les conseils de calendrier, placements et enchères LinkedIn.");
  const proposedBudget = { startAt: budget.startAt ?? null, endAt: budget.endAt ?? null, ...human.constraints.budget };
  for (const instant of [proposedBudget.startAt, proposedBudget.endAt]) if (instant !== null && !isoInstant(instant)) return fail("Vérifiez les dates ISO et leur fuseau horaire pour LinkedIn.");
  const candidate = {
    ...defaultLinkedInDeliverySettings(),
    locationType: human.constraints.locationType ?? (raw.locationType === undefined ? "recent_or_permanent" : raw.locationType),
    budget: { type: "daily", totalEuros: null, ...proposedBudget },
    placements: { audienceNetwork: placements.audienceNetwork === undefined ? false : placements.audienceNetwork, audienceExpansion: placements.audienceExpansion === undefined ? false : placements.audienceExpansion, ...human.constraints.placements },
    bidding: { strategy: bidding.strategy === undefined ? "maximum_delivery" : bidding.strategy, amountEuros: bidding.amountEuros === undefined ? null : bidding.amountEuros, ...human.constraints.bidding },
  };
  if (candidate.bidding.strategy === "maximum_delivery") candidate.bidding.amountEuros = null;
  const normalized = normalizeLinkedInDeliverySettings(candidate);
  if (normalized.error || !normalized.settings) return fail(normalized.error || "Vérifiez les conseils de diffusion LinkedIn.");
  const settings = normalized.settings;
  const nowMs = context.now === undefined ? null : Date.parse(context.now);
  if (nowMs !== null && (!isoInstant(context.now) || !Number.isFinite(nowMs))) return fail("L’heure courante du contexte LinkedIn est invalide.");
  if (nowMs !== null && ((settings.budget.startAt && Date.parse(settings.budget.startAt) < nowMs + 60_000) || (settings.budget.endAt && Date.parse(settings.budget.endAt) <= (settings.budget.startAt ? Date.parse(settings.budget.startAt) : nowMs)))) return fail("Les dates de diffusion LinkedIn doivent être futures et la fin doit suivre le début.");
  // The application already limits campaign planning to the next 90 days.
  if (nowMs !== null && [settings.budget.startAt, settings.budget.endAt].some((instant) => instant && Date.parse(instant) > nowMs + 90 * 86_400_000)) return fail("Planifiez la diffusion LinkedIn dans les 90 prochains jours.");
  // Lead-form campaigns remain reviewable drafts. Their publisher gate is
  // separate; do not pretend that the current adapter can serialize bidding.
  if (context.objectiveType !== "LEAD_GENERATION" && !linkedInDeliveryBidding(context.objectiveType || "WEBSITE_VISIT", settings)) return fail("La stratégie d’enchères proposée n’est pas compatible avec l’objectif LinkedIn.");
  if (settings.placements.audienceNetwork && context.format && context.format !== "STANDARD_UPDATE" && context.format !== "SINGLE_VIDEO") return fail("Le réseau de partenaires LinkedIn demande un format image unique ou vidéo pris en charge.");
  return { suggestion: { locationType: settings.locationType, budget: { startAt: settings.budget.startAt, endAt: settings.budget.endAt }, placements: settings.placements, bidding: settings.bidding }, error: null };
}
