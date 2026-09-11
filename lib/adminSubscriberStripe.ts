import type {
  AdminSubscriberProfileRow,
  AdminSubscriberSubscriptionRow,
} from "./adminSubscribers.ts";

type LooseObject = Record<string, unknown>;

export const STRIPE_CURRENT_SUBSCRIBER_STATUSES = [
  "active",
  "past_due",
  "unpaid",
  "paused",
] as const;

const CURRENT_STATUS_SET = new Set<string>(STRIPE_CURRENT_SUBSCRIBER_STATUSES);
const STRIPE_STATUS_SET = new Set([
  ...STRIPE_CURRENT_SUBSCRIBER_STATUSES,
  "trialing",
  "incomplete",
  "incomplete_expired",
  "canceled",
]);

export type StripeAdminSubscriberSnapshot = {
  subscription_id: string;
  customer_id: string | null;
  metadata_user_id: string | null;
  subscription_metadata_user_id: string | null;
  customer_metadata_user_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  identity_conflict: boolean;
  status: string;
  amount_eur: number | null;
  billing_cycle: string | null;
  next_renewal_date: string | null;
  price_id: string | null;
  created_at: string | null;
};

export type AdminSubscriberReconciliationRecord = {
  subscription: AdminSubscriberSubscriptionRow;
  profile: AdminSubscriberProfileRow | null;
};

export type AdminSubscriberStripeMatchMethod =
  | "subscription_id"
  | "metadata_user_id"
  | "customer_id"
  | "email"
  | "company_exact"
  | "multi_signal";

export type AdminSubscriberStripeMatch = {
  snapshot: StripeAdminSubscriberSnapshot;
  method: AdminSubscriberStripeMatchMethod;
  write_safe: boolean;
};

export type AdminSubscriberStripeMatchResult = {
  matchesByUserId: Map<string, AdminSubscriberStripeMatch>;
  ambiguousUserIds: Set<string>;
  unmatchedStripeSubscriptionIds: Set<string>;
  matchMethodCounts: Record<AdminSubscriberStripeMatchMethod, number>;
};

function asObject(value: unknown): LooseObject | null {
  return value && typeof value === "object" ? (value as LooseObject) : null;
}

function textOrNull(value: unknown): string | null {
  const valueAsText = String(value ?? "").trim();
  return valueAsText || null;
}

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return textOrNull(value);
  return textOrNull(asObject(value)?.id);
}

function unixDate(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function subscriptionPeriodEnd(subscription: LooseObject): string | null {
  const items = asObject(subscription.items);
  // Stripe embeds only the first page of items. A partial list cannot yield an
  // honest account-level renewal date.
  if (items?.has_more === true) return null;

  const candidates = unique([unixDate(subscription.current_period_end)]);
  const data = Array.isArray(items?.data) ? items.data : [];
  for (const rawItem of data) {
    const candidate = unixDate(asObject(rawItem)?.current_period_end);
    if (candidate) candidates.push(candidate);
  }
  // "Prochain renouvellement" means the first upcoming contract boundary,
  // never the most distant item date.
  return candidates.sort()[0] ?? null;
}

function monthlyFactor(interval: string, intervalCount: number): number | null {
  if (!Number.isFinite(intervalCount) || intervalCount <= 0) return null;
  if (interval === "month") return 1 / intervalCount;
  if (interval === "year") return 1 / (12 * intervalCount);
  if (interval === "week") return 52 / (12 * intervalCount);
  if (interval === "day") return 365 / (12 * intervalCount);
  return null;
}

export function stripeSubscriptionMonthlyTerms(value: unknown): {
  amountEur: number | null;
  billingCycle: string | null;
  priceId: string | null;
} {
  const subscription = asObject(value);
  if (!subscription) {
    return { amountEur: null, billingCycle: null, priceId: null };
  }
  const items = asObject(subscription.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  if (items?.has_more === true) {
    return { amountEur: null, billingCycle: null, priceId: null };
  }
  const cycles = new Set<string>();
  let amountEur = 0;
  let recurringItemCount = 0;
  let firstPriceId: string | null = null;

  for (const rawItem of data) {
    const item = asObject(rawItem);
    const price = asObject(item?.price);
    const recurring = asObject(price?.recurring);
    if (!price || !recurring) continue;

    recurringItemCount += 1;
    firstPriceId ||= stripeObjectId(price);
    const currency = String(price.currency ?? "").trim().toLowerCase();
    const billingScheme = String(price.billing_scheme ?? "per_unit").trim().toLowerCase();
    const usageType = String(recurring.usage_type ?? "licensed").trim().toLowerCase();
    const interval = String(recurring.interval ?? "").trim().toLowerCase();
    const intervalCount = Number(recurring.interval_count ?? 1);
    const factor = monthlyFactor(interval, intervalCount);
    const unitAmountCents = Number(price.unit_amount_decimal ?? price.unit_amount);
    const quantity = Number(item?.quantity ?? 1);

    // A tiered, non-EUR or incomplete price cannot be represented honestly as
    // the requested monthly EUR amount. Never turn it into a misleading zero.
    if (
      currency !== "eur" ||
      billingScheme === "tiered" ||
      usageType === "metered" ||
      Boolean(price.transform_quantity) ||
      factor == null ||
      !Number.isFinite(unitAmountCents) ||
      unitAmountCents < 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return { amountEur: null, billingCycle: null, priceId: firstPriceId };
    }

    amountEur += (unitAmountCents * quantity * factor) / 100;
    if (interval === "month" && intervalCount === 1) cycles.add("monthly");
    else if (interval === "year" && intervalCount === 1) cycles.add("yearly");
    else cycles.add(`${interval}:${intervalCount}`);
  }

  if (recurringItemCount === 0) {
    return { amountEur: null, billingCycle: null, priceId: firstPriceId };
  }

  return {
    amountEur: Math.round(amountEur * 100) / 100,
    billingCycle:
      cycles.size > 1
        ? "mixed"
        : cycles.has("monthly")
          ? "monthly"
          : cycles.has("yearly")
            ? "yearly"
            : "other",
    priceId: firstPriceId,
  };
}

export function stripeAdminSubscriberSnapshot(
  value: unknown,
): StripeAdminSubscriberSnapshot | null {
  const subscription = asObject(value);
  const subscriptionId = stripeObjectId(subscription);
  if (!subscription || !subscriptionId) return null;

  // This admin view is backed by production Supabase. Test-mode Stripe data
  // must never be reconciled with real customer accounts.
  if (subscription.livemode !== true) return null;

  const status = String(subscription.status ?? "").trim().toLowerCase();
  if (!STRIPE_STATUS_SET.has(status)) return null;

  const customer = asObject(subscription.customer);
  const metadata = asObject(subscription.metadata);
  const customerMetadata = asObject(customer?.metadata);
  const subscriptionMetadataUserId = textOrNull(metadata?.user_id);
  const customerMetadataUserId = textOrNull(customerMetadata?.user_id);
  const identityConflict = Boolean(
    subscriptionMetadataUserId &&
      customerMetadataUserId &&
      subscriptionMetadataUserId !== customerMetadataUserId,
  );
  const amount = stripeSubscriptionMonthlyTerms(subscription);
  const periodEnd =
    amount.billingCycle === "monthly" || amount.billingCycle === "yearly"
      ? subscriptionPeriodEnd(subscription)
      : null;

  return {
    subscription_id: subscriptionId,
    customer_id: stripeObjectId(subscription.customer),
    metadata_user_id: identityConflict
      ? null
      : subscriptionMetadataUserId || customerMetadataUserId,
    subscription_metadata_user_id: subscriptionMetadataUserId,
    customer_metadata_user_id: customerMetadataUserId,
    customer_name: textOrNull(customer?.name),
    customer_email: textOrNull(customer?.email),
    customer_phone: textOrNull(customer?.phone),
    identity_conflict: identityConflict,
    status,
    amount_eur: amount.amountEur,
    billing_cycle: amount.billingCycle,
    next_renewal_date: periodEnd?.slice(0, 10) ?? null,
    price_id: amount.priceId,
    created_at: unixDate(subscription.created),
  };
}

export function isCurrentStripeSubscriber(snapshot: StripeAdminSubscriberSnapshot): boolean {
  return CURRENT_STATUS_SET.has(snapshot.status);
}

function normalizedIdentity(value: unknown): string | null {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.length >= 5 ? normalized : null;
}

const GENERIC_BRAND_SEGMENTS = new Set([
  "admin",
  "billing",
  "bonjour",
  "commercial",
  "compta",
  "contact",
  "direction",
  "facturation",
  "hello",
  "service",
]);

function brandSegment(value: unknown): string | null {
  const identity = normalizedIdentity(value);
  if (!identity) return null;
  const compact = identity.replace(/\s+/g, "").replace(/\d+$/g, "");
  if (compact.length < 5 || GENERIC_BRAND_SEGMENTS.has(compact)) return null;
  return compact;
}

function normalizedEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function emailBrandSegment(value: unknown): string | null {
  const email = normalizedEmail(value);
  if (!email) return null;
  return brandSegment(email.split("@")[0]);
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function localEmails(record: AdminSubscriberReconciliationRecord): string[] {
  return unique([
    normalizedEmail(record.profile?.admin_email),
    normalizedEmail(record.profile?.contact_email),
    normalizedEmail(record.subscription.contact_email),
  ]);
}

function localCompany(record: AdminSubscriberReconciliationRecord): string[] {
  return unique([normalizedIdentity(record.profile?.company_legal_name)]);
}

function localFullName(record: AdminSubscriberReconciliationRecord): string[] {
  return unique([
    normalizedIdentity(
      [record.profile?.first_name, record.profile?.last_name].filter(Boolean).join(" "),
    ),
  ]);
}

function localSurname(record: AdminSubscriberReconciliationRecord): string[] {
  return unique([normalizedIdentity(record.profile?.last_name)]);
}

function localBrandSegments(record: AdminSubscriberReconciliationRecord): string[] {
  return unique([
    brandSegment(record.profile?.company_legal_name),
    ...localEmails(record).map(emailBrandSegment),
  ]);
}

function stripeEmails(snapshot: StripeAdminSubscriberSnapshot): string[] {
  return unique([normalizedEmail(snapshot.customer_email)]);
}

function stripeCompany(snapshot: StripeAdminSubscriberSnapshot): string[] {
  return unique([normalizedIdentity(snapshot.customer_name)]);
}

function stripeBrandSegments(snapshot: StripeAdminSubscriberSnapshot): string[] {
  // Kept independent from customer.name so company + brand really represents
  // two distinct Stripe identity fields rather than the same text twice.
  return unique([emailBrandSegment(snapshot.customer_email)]);
}

function paymentProviderAllowsStripe(record: AdminSubscriberReconciliationRecord): boolean {
  const provider = String(record.subscription.billing_provider ?? "").trim().toLowerCase();
  return !provider || provider === "stripe";
}

function delimitedIdentitySegments(value: unknown): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  // Only explicit business/person separators count. Arbitrary substrings of a
  // name are intentionally excluded ("Maison Dupont" must not imply Dupont).
  return unique(
    raw
      .split(/\s+(?:[-–—|/])\s+|[|/]/g)
      .map(normalizedIdentity),
  );
}

type StripeKeyResolution = {
  snapshot: StripeAdminSubscriberSnapshot | null;
  ambiguous: boolean;
};

function buildStripeResolutionIndex(
  snapshots: StripeAdminSubscriberSnapshot[],
  stripeKeys: (snapshot: StripeAdminSubscriberSnapshot) => string[],
  allowTerminal: boolean,
): Map<string, StripeKeyResolution> {
  const rawIndex = new Map<string, StripeAdminSubscriberSnapshot[]>();
  for (const snapshot of snapshots) {
    if (snapshot.identity_conflict) continue;
    for (const key of stripeKeys(snapshot)) {
      const values = rawIndex.get(key) ?? [];
      values.push(snapshot);
      rawIndex.set(key, values);
    }
  }

  const index = new Map<string, StripeKeyResolution>();
  for (const [key, values] of rawIndex) {
    const current = values.filter(isCurrentStripeSubscriber);
    if (current.length === 1) {
      index.set(key, { snapshot: current[0], ambiguous: false });
    } else if (current.length > 1) {
      index.set(key, { snapshot: null, ambiguous: true });
    } else if (allowTerminal && values.length === 1) {
      index.set(key, { snapshot: values[0], ambiguous: false });
    } else if (values.length > 0) {
      index.set(key, { snapshot: null, ambiguous: true });
    }
  }
  return index;
}

function buildLocalKeyCounts(
  records: AdminSubscriberReconciliationRecord[],
  localKeys: (record: AdminSubscriberReconciliationRecord) => string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!paymentProviderAllowsStripe(record)) continue;
    for (const key of localKeys(record)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

type CandidateCollection = {
  candidates: Map<string, StripeAdminSubscriberSnapshot>;
  sawSignal: boolean;
  ambiguous: boolean;
};

function collectCandidates(
  keys: string[],
  localCounts: Map<string, number>,
  stripeIndex: Map<string, StripeKeyResolution>,
): CandidateCollection {
  const candidates = new Map<string, StripeAdminSubscriberSnapshot>();
  let sawSignal = false;
  let ambiguous = false;
  for (const key of keys) {
    const resolution = stripeIndex.get(key);
    if (!resolution) continue;
    sawSignal = true;
    if ((localCounts.get(key) ?? 0) !== 1 || resolution.ambiguous) {
      ambiguous = true;
      continue;
    }
    if (resolution.snapshot) {
      candidates.set(resolution.snapshot.subscription_id, resolution.snapshot);
    }
  }
  return { candidates, sawSignal, ambiguous };
}

export function matchAdminSubscribersToStripe(
  records: AdminSubscriberReconciliationRecord[],
  snapshots: StripeAdminSubscriberSnapshot[],
): AdminSubscriberStripeMatchResult {
  const matchesByUserId = new Map<string, AdminSubscriberStripeMatch>();
  const ambiguousUserIds = new Set<string>();
  const matchMethodCounts: Record<AdminSubscriberStripeMatchMethod, number> = {
    subscription_id: 0,
    metadata_user_id: 0,
    customer_id: 0,
    email: 0,
    company_exact: 0,
    multi_signal: 0,
  };

  const localUserIds = new Set(records.map((record) => record.subscription.user_id));
  const recordsByUserId = new Map(
    records.map((record) => [record.subscription.user_id, record]),
  );
  const explicitSubscriptionOwners = new Map<string, Set<string>>();
  const explicitCustomerOwners = new Map<string, Set<string>>();
  const addOwner = (index: Map<string, Set<string>>, key: string | null, userId: string) => {
    if (!key) return;
    const owners = index.get(key) ?? new Set<string>();
    owners.add(userId);
    index.set(key, owners);
  };
  for (const record of records) {
    addOwner(
      explicitSubscriptionOwners,
      textOrNull(record.subscription.stripe_subscription_id),
      record.subscription.user_id,
    );
    addOwner(
      explicitCustomerOwners,
      textOrNull(record.subscription.stripe_customer_id),
      record.subscription.user_id,
    );
  }

  // Reserve every explicitly-owned Stripe object before considering metadata
  // or identity heuristics. This prevents one subscription from being linked
  // to A through metadata while it is already owned by B in Supabase.
  const matchableSnapshots: StripeAdminSubscriberSnapshot[] = [];
  for (const snapshot of snapshots) {
    const owners = new Set<string>();
    const subscriptionOwners =
      explicitSubscriptionOwners.get(snapshot.subscription_id) ?? new Set<string>();
    for (const owner of subscriptionOwners) {
      owners.add(owner);
    }
    const customerOwners = explicitCustomerOwners.get(snapshot.customer_id ?? "") ?? new Set();
    const subscriptionMetadataUserId = snapshot.subscription_metadata_user_id;
    const customerMetadataUserId = snapshot.customer_metadata_user_id;
    let effectiveMetadataUserId: string | null = null;
    let unresolvedMetadataConflict = false;

    if (subscriptionOwners.size > 0) {
      // A subscription id is one-to-one. Its own metadata may corroborate or
      // contradict that owner; customer metadata cannot veto it because one
      // Stripe customer may legitimately be shared by multiple accounts.
      if (subscriptionMetadataUserId) owners.add(subscriptionMetadataUserId);
      effectiveMetadataUserId = subscriptionMetadataUserId;
    } else {
      // Without an explicit subscription owner, customer id is usable only
      // when it has exactly one local owner. Subscription metadata stays above
      // customer metadata, but disagreement remains review-only until a strong
      // subscription id relationship exists.
      if (customerOwners.size === 1) {
        for (const owner of customerOwners) owners.add(owner);
      }
      // Customer metadata is account-level and may be shared; it never becomes
      // a write-safe metadata match by itself. Subscription metadata is the
      // only metadata source specific enough for automatic reconciliation.
      effectiveMetadataUserId = subscriptionMetadataUserId;
      if (effectiveMetadataUserId) owners.add(effectiveMetadataUserId);
      if (!subscriptionMetadataUserId && customerOwners.size === 1 && customerMetadataUserId) {
        owners.add(customerMetadataUserId);
      }
      if (
        subscriptionMetadataUserId &&
        customerMetadataUserId &&
        subscriptionMetadataUserId !== customerMetadataUserId
      ) {
        unresolvedMetadataConflict = true;
        owners.add(customerMetadataUserId);
      }
    }

    const hasNativeOwner = Array.from(owners).some((owner) => {
      const record = recordsByUserId.get(owner);
      return record ? !paymentProviderAllowsStripe(record) : false;
    });
    if (unresolvedMetadataConflict || owners.size > 1 || hasNativeOwner) {
      for (const owner of owners) {
        if (localUserIds.has(owner)) ambiguousUserIds.add(owner);
      }
      continue;
    }
    matchableSnapshots.push({
      ...snapshot,
      metadata_user_id: effectiveMetadataUserId,
      // Any customer-metadata disagreement that reached this point was safely
      // dominated by an explicit subscription owner plus subscription metadata.
      identity_conflict: false,
    });
  }

  const bySubscriptionId = buildStripeResolutionIndex(
    matchableSnapshots,
    (snapshot) => [snapshot.subscription_id],
    true,
  );
  const byMetadataUserId = buildStripeResolutionIndex(
    matchableSnapshots,
    (snapshot) => unique([snapshot.metadata_user_id]),
    true,
  );
  const byCustomerId = buildStripeResolutionIndex(
    matchableSnapshots,
    (snapshot) => unique([snapshot.customer_id]),
    true,
  );
  const byEmail = buildStripeResolutionIndex(matchableSnapshots, stripeEmails, false);
  const byCompanyExact = buildStripeResolutionIndex(matchableSnapshots, stripeCompany, false);
  const byNameSegment = buildStripeResolutionIndex(
    matchableSnapshots,
    (snapshot) => delimitedIdentitySegments(snapshot.customer_name),
    false,
  );
  const byBrand = buildStripeResolutionIndex(matchableSnapshots, stripeBrandSegments, false);

  const subIdCounts = buildLocalKeyCounts(records, (record) =>
    unique([textOrNull(record.subscription.stripe_subscription_id)]),
  );
  const userIdCounts = buildLocalKeyCounts(records, (record) => [record.subscription.user_id]);
  const customerIdCounts = buildLocalKeyCounts(records, (record) =>
    unique([textOrNull(record.subscription.stripe_customer_id)]),
  );
  const emailCounts = buildLocalKeyCounts(records, localEmails);
  const companyCounts = buildLocalKeyCounts(records, localCompany);
  const fullNameCounts = buildLocalKeyCounts(records, localFullName);
  const surnameCounts = buildLocalKeyCounts(records, localSurname);
  const brandCounts = buildLocalKeyCounts(records, localBrandSegments);

  const proposals = new Map<
    string,
    {
      snapshot: StripeAdminSubscriberSnapshot;
      method: AdminSubscriberStripeMatchMethod;
      write_safe: boolean;
    }
  >();

  for (const record of records) {
    const userId = record.subscription.user_id;
    if (!paymentProviderAllowsStripe(record)) continue;

    // Phase 1: explicit ids and Stripe metadata. Secondary identity data can
    // neither override nor invalidate a unique direct relationship.
    const explicitSubscriptionId = textOrNull(record.subscription.stripe_subscription_id);
    const explicitCustomerId = textOrNull(record.subscription.stripe_customer_id);
    const subscriptionIdResult = collectCandidates(
      unique([explicitSubscriptionId]),
      subIdCounts,
      bySubscriptionId,
    );
    const customerIdResult = collectCandidates(
      unique([explicitCustomerId]),
      customerIdCounts,
      byCustomerId,
    );
    const metadataResult = collectCandidates([userId], userIdCounts, byMetadataUserId);
    const uniqueCandidate = (result: CandidateCollection) =>
      result.candidates.size === 1 ? Array.from(result.candidates.values())[0] : null;
    const subscriptionIdCandidate = uniqueCandidate(subscriptionIdResult);
    const customerIdCandidate = uniqueCandidate(customerIdResult);
    const metadataCandidate = uniqueCandidate(metadataResult);
    const metadataAllowsUser = (snapshot: StripeAdminSubscriberSnapshot) =>
      !snapshot.identity_conflict &&
      (!snapshot.metadata_user_id || snapshot.metadata_user_id === userId);
    const conflictsWith = (
      winner: StripeAdminSubscriberSnapshot,
      alternatives: Array<StripeAdminSubscriberSnapshot | null>,
    ) => alternatives.some(
      (candidate) => candidate && candidate.subscription_id !== winner.subscription_id,
    );

    if (explicitSubscriptionId) {
      if (
        !subscriptionIdCandidate ||
        subscriptionIdResult.ambiguous ||
        !metadataAllowsUser(subscriptionIdCandidate) ||
        conflictsWith(subscriptionIdCandidate, [metadataCandidate])
      ) {
        ambiguousUserIds.add(userId);
      } else {
        proposals.set(userId, {
          snapshot: subscriptionIdCandidate,
          method: "subscription_id",
          write_safe: true,
        });
      }
      continue;
    }

    if (explicitCustomerId) {
      if (metadataCandidate && !metadataResult.ambiguous) {
        if (
          !metadataAllowsUser(metadataCandidate) ||
          conflictsWith(metadataCandidate, [customerIdCandidate])
        ) {
          ambiguousUserIds.add(userId);
        } else {
          proposals.set(userId, {
            snapshot: metadataCandidate,
            method: "metadata_user_id",
            write_safe: true,
          });
        }
        continue;
      }
      if (
        !customerIdCandidate ||
        customerIdResult.ambiguous ||
        !metadataAllowsUser(customerIdCandidate) ||
        conflictsWith(customerIdCandidate, [metadataCandidate])
      ) {
        ambiguousUserIds.add(userId);
      } else {
        proposals.set(userId, {
          snapshot: customerIdCandidate,
          method: "customer_id",
          write_safe: true,
        });
      }
      continue;
    }

    if (metadataCandidate) {
      if (metadataResult.ambiguous) {
        ambiguousUserIds.add(userId);
      } else {
        proposals.set(userId, {
          snapshot: metadataCandidate,
          method: "metadata_user_id",
          write_safe: true,
        });
      }
      continue;
    }
    if (metadataResult.ambiguous) {
      ambiguousUserIds.add(userId);
      continue;
    }

    // Phase 2: a case-insensitive exact email is sufficient only when it is
    // unique on both sides. An email collision is terminal for auto-matching.
    const emailResult = collectCandidates(localEmails(record), emailCounts, byEmail);
    for (const [candidateId, candidate] of emailResult.candidates) {
      if (!metadataAllowsUser(candidate)) {
        emailResult.candidates.delete(candidateId);
        emailResult.ambiguous = true;
      }
    }
    if (emailResult.candidates.size > 1 || emailResult.ambiguous) {
      ambiguousUserIds.add(userId);
      continue;
    }
    if (emailResult.candidates.size === 1) {
      proposals.set(userId, {
        snapshot: Array.from(emailResult.candidates.values())[0],
        method: "email",
        write_safe: true,
      });
      continue;
    }

    // Phase 3: exact, token-delimited identity evidence. Person names are only
    // supporting signals; fuzzy/substring matching is intentionally absent.
    const evidence = new Map<string, {
      snapshot: StripeAdminSubscriberSnapshot;
      labels: Set<string>;
    }>();
    let secondaryAmbiguous = false;
    const addEvidence = (label: string, result: CandidateCollection) => {
      secondaryAmbiguous ||= result.ambiguous;
      for (const snapshot of result.candidates.values()) {
        if (!metadataAllowsUser(snapshot)) {
          secondaryAmbiguous = true;
          continue;
        }
        const current = evidence.get(snapshot.subscription_id) ?? {
          snapshot,
          labels: new Set<string>(),
        };
        current.labels.add(label);
        evidence.set(snapshot.subscription_id, current);
      }
    };
    addEvidence(
      "company_exact",
      collectCandidates(localCompany(record), companyCounts, byCompanyExact),
    );
    addEvidence(
      "company_segment",
      collectCandidates(localCompany(record), companyCounts, byNameSegment),
    );
    addEvidence(
      "person_segment",
      collectCandidates(localFullName(record), fullNameCounts, byNameSegment),
    );
    addEvidence(
      "surname_segment",
      collectCandidates(localSurname(record), surnameCounts, byNameSegment),
    );
    addEvidence(
      "brand_segment",
      collectCandidates(localBrandSegments(record), brandCounts, byBrand),
    );

    const hasExactCompanyCandidate = Array.from(evidence.values()).some((entry) =>
      entry.labels.has("company_exact"),
    );
    if (evidence.size > 1 || (secondaryAmbiguous && !hasExactCompanyCandidate)) {
      ambiguousUserIds.add(userId);
      continue;
    }
    if (evidence.size === 1) {
      const only = Array.from(evidence.values())[0];
      const hasCompany =
        only.labels.has("company_exact") || only.labels.has("company_segment");
      const hasPerson =
        only.labels.has("person_segment") || only.labels.has("surname_segment");
      const hasBrand = only.labels.has("brand_segment");
      const exactCompany = only.labels.has("company_exact");
      const companyKeys = new Set(localCompany(record));
      const personKeys = unique([...localFullName(record), ...localSurname(record)]);
      const companyPersonKeysAreDistinct = personKeys.every(
        (key) => !companyKeys.has(key),
      );
      const convergent =
        (hasCompany && hasPerson && companyPersonKeysAreDistinct) ||
        (hasBrand && hasPerson) ||
        (hasCompany && hasBrand);

      if (exactCompany || convergent) {
        proposals.set(userId, {
          snapshot: only.snapshot,
          method: convergent ? "multi_signal" : "company_exact",
          // A company-name-only association is useful for the read-only admin
          // overlay, but it cannot silently change access in Supabase.
          write_safe: convergent,
        });
      } else if (secondaryAmbiguous) {
        ambiguousUserIds.add(userId);
      }
    }
  }

  const usersBySubscriptionId = new Map<string, string[]>();
  for (const [userId, proposal] of proposals) {
    const users = usersBySubscriptionId.get(proposal.snapshot.subscription_id) ?? [];
    users.push(userId);
    usersBySubscriptionId.set(proposal.snapshot.subscription_id, users);
  }

  for (const [userId, proposal] of proposals) {
    const collision = usersBySubscriptionId.get(proposal.snapshot.subscription_id) ?? [];
    if (collision.length !== 1 || ambiguousUserIds.has(userId)) {
      for (const collidingUserId of collision) ambiguousUserIds.add(collidingUserId);
      continue;
    }
    matchesByUserId.set(userId, proposal);
    matchMethodCounts[proposal.method] += 1;
  }

  const usedStripeIds = new Set(
    Array.from(matchesByUserId.values(), ({ snapshot }) => snapshot.subscription_id),
  );
  const unmatchedStripeSubscriptionIds = new Set(
    snapshots
      .filter(isCurrentStripeSubscriber)
      .map((snapshot) => snapshot.subscription_id)
      .filter((subscriptionId) => !usedStripeIds.has(subscriptionId)),
  );

  return {
    matchesByUserId,
    ambiguousUserIds,
    unmatchedStripeSubscriptionIds,
    matchMethodCounts,
  };
}

export function overlaySubscriptionWithStripe(
  subscription: AdminSubscriberSubscriptionRow,
  snapshot: StripeAdminSubscriberSnapshot,
): AdminSubscriberSubscriptionRow {
  return {
    ...subscription,
    status: snapshot.status,
    monthly_price_eur: snapshot.amount_eur,
    billing_cycle: snapshot.billing_cycle,
    billing_provider: "stripe",
    stripe_customer_id: snapshot.customer_id,
    stripe_subscription_id: snapshot.subscription_id,
    stripe_price_id: snapshot.price_id,
    next_renewal_date: snapshot.next_renewal_date,
  };
}
