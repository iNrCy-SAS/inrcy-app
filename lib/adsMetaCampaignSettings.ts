/** Website traffic only: these options do not claim a Pixel or conversions. */
export const META_CALL_TO_ACTIONS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "GET_QUOTE", "BOOK_TRAVEL", "DOWNLOAD"] as const;
export type MetaCallToAction = typeof META_CALL_TO_ACTIONS[number];
export const META_CALL_TO_ACTION_LABELS: Record<MetaCallToAction, string> = { LEARN_MORE: "En savoir plus", SHOP_NOW: "Acheter", SIGN_UP: "S’inscrire", CONTACT_US: "Nous contacter", GET_QUOTE: "Demander un devis", BOOK_TRAVEL: "Réserver", DOWNLOAD: "Télécharger" };
export type MetaDeliverySettings = {
  budget: { type: "daily" | "total"; totalEuros: number | null; startAt: string | null; endAt: string | null };
  bidding: { strategy: "maximum_delivery" | "bid_cap"; amountEuros: number | null };
  callToAction: MetaCallToAction;
  optimizationGoal: "link_clicks";
  audience: { ageMin: number; ageMax: number | null };
};
export function defaultMetaDeliverySettings(): MetaDeliverySettings { return { budget: { type: "daily", totalEuros: null, startAt: null, endAt: null }, bidding: { strategy: "maximum_delivery", amountEuros: null }, callToAction: "LEARN_MORE", optimizationGoal: "link_clicks", audience: { ageMin: 18, ageMax: null } }; }
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
const money = (value: unknown, minimum: number, maximum: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
export function metaAdsInstant(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const wall = value.slice(0, 19), check = Date.parse(wall + "Z"), time = Date.parse(value);
  if (!Number.isFinite(time) || !Number.isFinite(check) || new Date(check).toISOString().slice(0, 19) !== wall) return null;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return null;
  return new Date(time).toISOString();
}
export function normalizeMetaDeliverySettings(value: unknown): { settings: MetaDeliverySettings | null; error: string | null } {
  if (value == null) return { settings: null, error: null };
  const fail = (error: string) => ({ settings: null, error });
  const raw = object(value), budget = object(raw?.budget), bidding = object(raw?.bidding), audience = object(raw?.audience);
  if (!raw || !budget || !bidding || !audience || !keys(raw, ["budget", "bidding", "callToAction", "optimizationGoal", "audience"]) || !keys(budget, ["type", "totalEuros", "startAt", "endAt"]) || !keys(bidding, ["strategy", "amountEuros"]) || !keys(audience, ["ageMin", "ageMax"])) return fail("Vérifiez les réglages natifs Meta.");
  if (budget.type !== "daily" && budget.type !== "total" || budget.type === "total" && !money(budget.totalEuros, 5, 45000) || budget.type === "daily" && budget.totalEuros != null) return fail("Choisissez un seul budget Meta : quotidien, ou total entre 5 et 45 000 €.");
  const startAt = budget.startAt == null ? null : metaAdsInstant(budget.startAt), endAt = budget.endAt == null ? null : metaAdsInstant(budget.endAt);
  if (budget.startAt != null && !startAt || budget.endAt != null && !endAt) return fail("Les dates Meta doivent être des dates ISO complètes avec leur fuseau.");
  if (bidding.strategy !== "maximum_delivery" && bidding.strategy !== "bid_cap" || bidding.strategy === "maximum_delivery" && bidding.amountEuros != null || bidding.strategy === "bid_cap" && !money(bidding.amountEuros, 0.01, 45000)) return fail("Choisissez les enchères automatiques sans montant, ou une enchère maximale Meta positive.");
  if (!META_CALL_TO_ACTIONS.includes(raw.callToAction as MetaCallToAction)) return fail("Choisissez un appel à l’action Meta disponible vers le site web.");
  if (raw.optimizationGoal !== "link_clicks") return fail("Ce parcours Meta optimise les clics sur le lien ; aucun événement de conversion n’est inventé.");
  if (!Number.isInteger(audience.ageMin) || Number(audience.ageMin) < 18 || Number(audience.ageMin) > 65 || audience.ageMax != null && (!Number.isInteger(audience.ageMax) || Number(audience.ageMax) < Number(audience.ageMin) || Number(audience.ageMax) > 65)) return fail("Choisissez des âges Meta entre 18 et 65 ans ; 65 signifie 65 ans et plus.");
  return { settings: { budget: { type: budget.type, totalEuros: budget.type === "total" ? budget.totalEuros as number : null, startAt, endAt }, bidding: { strategy: bidding.strategy, amountEuros: bidding.strategy === "bid_cap" ? bidding.amountEuros as number : null }, callToAction: raw.callToAction as MetaCallToAction, optimizationGoal: "link_clicks", audience: { ageMin: Number(audience.ageMin), ageMax: audience.ageMax == null ? null : Number(audience.ageMax) } }, error: null };
}
type MetaDeliveryDraft = { dailyBudgetEuros: number; endDate: string; metaDeliverySettings?: MetaDeliverySettings };
/** Historical deadline, usable for review even after expiry. Publication validates it separately. */
export function metaAdsLegacyEndTime(endDate: string) {
  const reference = new Date(`${endDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(reference.getTime()) || reference.toISOString().slice(0, 10) !== endDate) throw new Error("La date de fin Meta est invalide.");
  const offsetName = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(reference).find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName || "");
  if (!offset) throw new Error("Impossible de déterminer le fuseau horaire de la campagne Meta.");
  const result = `${endDate}T23:59:59${offset[1]}${offset[2].padStart(2, "0")}:${offset[3] || "00"}`;
  return result;
}
/** Display exact saved dates without validating spend, budgets or whether the deadline is still future. */
export function metaAdsDisplayCalendar(draft: Pick<MetaDeliveryDraft, "endDate" | "metaDeliverySettings">): { startAt: string | null; endAt: string | null; startInvalid: boolean; endInvalid: boolean } {
  const rawStart = draft.metaDeliverySettings?.budget.startAt;
  const rawEnd = draft.metaDeliverySettings?.budget.endAt;
  const startAt = rawStart == null ? null : metaAdsInstant(rawStart);
  if (rawEnd != null) {
    const endAt = metaAdsInstant(rawEnd);
    return { startAt, endAt, startInvalid: rawStart != null && !startAt, endInvalid: !endAt };
  }
  const endDate = typeof draft.endDate === "string" ? draft.endDate.trim() : "";
  if (!endDate) return { startAt, endAt: null, startInvalid: rawStart != null && !startAt, endInvalid: false };
  try { return { startAt, endAt: metaAdsLegacyEndTime(endDate), startInvalid: rawStart != null && !startAt, endInvalid: false }; }
  catch { return { startAt, endAt: null, startInvalid: rawStart != null && !startAt, endInvalid: true }; }
}
function legacyMetaEndTime(endDate: string, now: number) {
  const result = metaAdsLegacyEndTime(endDate);
  const days = (Date.parse(result) - now) / 86_400_000;
  if (days < 1 || days > 90) throw new Error("La fin de campagne Meta doit être comprise entre demain et dans 90 jours.");
  return result;
}
/** Missing settings preserve the historical daily budget, Paris end time and fixed CTA. */
export function metaNativeDelivery(draft: MetaDeliveryDraft, now = Date.now()) {
  const parsed = normalizeMetaDeliverySettings(draft.metaDeliverySettings);
  if (parsed.error) throw new Error(parsed.error);
  const settings = parsed.settings;
  const amount = settings?.budget.type === "total" ? settings.budget.totalEuros : draft.dailyBudgetEuros;
  if (!money(amount, 5, settings?.budget.type === "total" ? 45000 : 500)) throw new Error("Vérifiez le budget Meta : 5 à 500 € par jour, ou 5 à 45 000 € au total dans iNrCy.");
  const start = settings?.budget.startAt ? Date.parse(settings.budget.startAt) : settings?.budget.type === "total" ? now + 60_000 : now;
  const endTime = settings?.budget.endAt || legacyMetaEndTime(draft.endDate, now);
  const end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < now - 60_000 || end <= Math.max(start, now) || end > now + 90 * 86_400_000) throw new Error("La diffusion Meta doit commencer maintenant ou plus tard, et finir après le début dans les 90 prochains jours.");
  const bid = settings?.bidding.amountEuros ?? null;
  if (bid != null && bid > amount) throw new Error("L’enchère maximale Meta ne peut pas dépasser le budget choisi.");
  return { budgetType: settings?.budget.type || "daily" as "daily" | "total", dailyBudgetCents: settings?.budget.type === "total" ? null : Math.round(amount * 100), lifetimeBudgetCents: settings?.budget.type === "total" ? Math.round(amount * 100) : null,
    startTime: settings?.budget.startAt || (settings?.budget.type === "total" ? new Date(now + 60_000).toISOString() : null), endTime,
    bidStrategy: settings?.bidding.strategy === "bid_cap" ? "LOWEST_COST_WITH_BID_CAP" as const : "LOWEST_COST_WITHOUT_CAP" as const, bidAmountCents: bid == null ? null : Math.round(bid * 100), callToAction: settings?.callToAction || "LEARN_MORE" as MetaCallToAction, ageMin: settings?.audience.ageMin || 18, ageMax: settings?.audience.ageMax ?? null };
}
