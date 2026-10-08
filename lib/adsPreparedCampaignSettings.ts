/** Draft-only delivery choices. They contain no provider IDs and authorize no publication. */
export type PreparedDeliverySettings = {
  budget: { type: "daily" | "total"; totalEuros: number | null; startAt: string | null; endAt: string | null };
  bidding: { strategy: "automatic" | "max_bid" | "cost_cap"; amountEuros: number | null };
};
export function defaultPreparedDeliverySettings(type: "daily" | "total" = "daily"): PreparedDeliverySettings {
  return { budget: { type, totalEuros: null, startAt: null, endAt: null }, bidding: { strategy: "automatic", amountEuros: null } };
}
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).length === allowed.length && Object.keys(value).every((key) => allowed.includes(key));
/** These are iNrCy preparation limits, not advertised provider account minimums. */
const money = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0.01 && value <= maximum && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

export function preparedAdsInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || Number(match[7] || 0) > 23 || Number(match[8] || 0) > 59) return null;
  const calendar = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const time = Date.parse(value);
  return Number.isSafeInteger(time) && time >= 946684800000 && time <= 4102444800000 ? new Date(time).toISOString() : null;
}
export function preparedAdsTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { new Intl.DateTimeFormat("fr-FR", { timeZone: value }).format(); return value; } catch { return null; }
}
export function preparedAdsLocalDateTime(instant: string | null, timeZone: string): string {
  if (!instant || !preparedAdsTimeZone(timeZone) || !Number.isFinite(Date.parse(instant))) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(Date.parse(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
/** Reject impossible or ambiguous local times rather than silently moving the prepared schedule. */
export function preparedAdsCalendarInstant(local: string, timeZone: string): string | null {
  if (!preparedAdsTimeZone(timeZone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const target = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 16) !== local) return null;
  let guess = target;
  for (let index = 0; index < 4; index++) {
    if (!Number.isFinite(guess)) return null;
    const shown = preparedAdsLocalDateTime(new Date(guess).toISOString(), timeZone);
    guess += target - Date.parse(`${shown}:00Z`);
  }
  if (!Number.isFinite(guess) || preparedAdsLocalDateTime(new Date(guess).toISOString(), timeZone) !== local) return null;
  if ([-7200000, -5400000, -3600000, -1800000, 1800000, 3600000, 5400000, 7200000].some((shift) => preparedAdsLocalDateTime(new Date(guess + shift).toISOString(), timeZone) === local)) return null;
  return preparedAdsInstant(new Date(guess).toISOString());
}
export function preparedAdsLegacyEndInstant(endDate: string): string | null {
  const minute = preparedAdsCalendarInstant(`${endDate}T23:59`, "Europe/Paris");
  return minute ? new Date(Date.parse(minute) + 59_000).toISOString() : null;
}
export function normalizePreparedDeliverySettings(value: unknown, provider?: "x" | "tiktok"): { settings: PreparedDeliverySettings | null; error: string | null } {
  if (value == null) return { settings: null, error: null };
  const fail = (error: string) => ({ settings: null, error });
  const raw = object(value), budget = object(raw?.budget), bidding = object(raw?.bidding);
  if (!raw || !budget || !bidding || !exactKeys(raw, ["budget", "bidding"]) || !exactKeys(budget, ["type", "totalEuros", "startAt", "endAt"]) || !exactKeys(bidding, ["strategy", "amountEuros"])) return fail("Les réglages préparés doivent contenir uniquement le budget, le calendrier et les enchères prévus.");
  if (budget.type !== "daily" && budget.type !== "total" || budget.type === "daily" && budget.totalEuros !== null || budget.type === "total" && (!money(budget.totalEuros, 45_000) || budget.totalEuros < 5)) return fail("Choisissez un budget quotidien, ou une enveloppe totale de 5 à 45 000 € dans iNrCy ; ne cumulez pas les deux.");
  const startAt = budget.startAt === null ? null : preparedAdsInstant(budget.startAt), endAt = budget.endAt === null ? null : preparedAdsInstant(budget.endAt);
  if (budget.startAt !== null && !startAt || budget.endAt !== null && !endAt) return fail("Les dates préparées doivent préciser une heure et son fuseau dans un format ISO valide.");
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) return fail("La fin préparée doit être après le début.");
  if (bidding.strategy !== "automatic" && bidding.strategy !== "max_bid" && bidding.strategy !== "cost_cap" || bidding.strategy === "automatic" && bidding.amountEuros !== null || bidding.strategy !== "automatic" && !money(bidding.amountEuros, 45_000)) return fail("Choisissez les enchères automatiques sans montant, ou un montant d’enchère positif avec deux décimales maximum.");
  if (provider === "tiktok" && bidding.strategy === "max_bid") return fail("Pour TikTok, choisissez Maximum Delivery ou Cost Cap avec un coût cible par résultat ; le plafond d’enchère X n’est pas adapté.");
  if (provider === "x" && bidding.strategy === "cost_cap") return fail("Pour X, choisissez les enchères automatiques ou un plafond d’enchère ; le coût cible TikTok n’est pas adapté.");
  return { settings: { budget: { type: budget.type, totalEuros: budget.type === "total" ? budget.totalEuros as number : null, startAt, endAt }, bidding: { strategy: bidding.strategy, amountEuros: bidding.strategy !== "automatic" ? bidding.amountEuros as number : null } }, error: null };
}
export type PreparedDeliveryDraft = { provider?: string; dailyBudgetEuros: number; endDate: string; preparedDeliverySettings?: PreparedDeliverySettings };
export type PreparedNativeCalendar = { budgetType: "daily" | "total"; amountEuros: number; dailyEuros: number | null; totalEuros: number | null; startAt: string | null; endAt: string; timeZone: string; bidding: PreparedDeliverySettings["bidding"] };
/** Produces a reviewable draft calendar only. No provider payload or permission to spend is returned. */
export function plannedNativeCalendar(draft: PreparedDeliveryDraft, now = Date.now(), zone = "Europe/Paris"): PreparedNativeCalendar {
  const timeZone = preparedAdsTimeZone(zone);
  if (!timeZone || !Number.isFinite(now)) throw new Error("Le fuseau et la date de référence du calendrier préparé sont invalides.");
  const checked = normalizePreparedDeliverySettings(draft.preparedDeliverySettings, draft.provider === "x" || draft.provider === "tiktok" ? draft.provider : undefined);
  if (checked.error) throw new Error(checked.error);
  const settings = checked.settings || defaultPreparedDeliverySettings();
  const amount = settings.budget.type === "total" ? settings.budget.totalEuros : draft.dailyBudgetEuros;
  if (!money(amount, settings.budget.type === "total" ? 45_000 : 500) || amount < 5) throw new Error("Précisez un budget de préparation iNrCy de 5 à 500 € par jour, ou de 5 à 45 000 € au total. Les limites du compte publicitaire restent à vérifier.");
  const endAt = settings.budget.endAt || preparedAdsLegacyEndInstant(draft.endDate);
  const start = settings.budget.startAt ? Date.parse(settings.budget.startAt) : now;
  if (!endAt || start < now - 60_000 || Date.parse(endAt) <= Math.max(start, now) || Date.parse(endAt) > now + 90 * 86_400_000) throw new Error("Le calendrier préparé doit commencer maintenant ou plus tard, et finir après le début dans les 90 prochains jours.");
  if (settings.bidding.amountEuros !== null && settings.bidding.amountEuros > amount) throw new Error("Le montant d’enchère préparé ne peut pas dépasser le budget choisi.");
  return { budgetType: settings.budget.type, amountEuros: amount, dailyEuros: settings.budget.type === "daily" ? amount : null, totalEuros: settings.budget.type === "total" ? amount : null, startAt: settings.budget.startAt, endAt, timeZone, bidding: settings.bidding };
}
