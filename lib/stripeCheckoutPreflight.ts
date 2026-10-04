import { collectStripeListPages } from "./adminSubscriberPagination.ts";

type StripeObject = Record<string, unknown>;
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]);
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);
const MAX_PAGES = 5;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function object(value: unknown): StripeObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("stripe_checkout_preflight_invalid");
  return value as StripeObject;
}

function id(value: unknown, prefix: "cus_" | "sub_"): string {
  const result = text(typeof value === "object" && value ? object(value).id : value);
  if (!result.startsWith(prefix) || !/^[A-Za-z0-9_]+$/.test(result)) throw new Error("stripe_checkout_preflight_invalid");
  return result;
}

function owner(value: StripeObject): string {
  return text(value.metadata && object(value.metadata).user_id);
}

async function listStripeObjects(
  get: (path: string) => Promise<unknown>,
  endpoint: string,
  filters: Record<string, string>,
): Promise<StripeObject[]> {
  const { rows } = await collectStripeListPages<StripeObject>({
    maxPages: MAX_PAGES,
    getId: (row) => text(row.id) || null,
    fetchPage: async (cursor, limit) => {
      const query = new URLSearchParams({ ...filters, limit: String(limit) });
      if (cursor) query.set("starting_after", cursor);
      const page = object(await get(`${endpoint}?${query}`));
      if (!Array.isArray(page.data) || typeof page.has_more !== "boolean") throw new Error("stripe_checkout_preflight_invalid");
      return { data: page.data.map(object), hasMore: page.has_more };
    },
  });
  return rows;
}

export async function findLiveStripeSubscriptions(
  customerId: string,
  get: (path: string) => Promise<unknown>,
): Promise<StripeObject[]> {
  const rows = await listStripeObjects(get, "/subscriptions", { customer: id(customerId, "cus_"), status: "all" });
  return rows.filter((row) => {
    id(row.id, "sub_");
    if (id(row.customer, "cus_") !== customerId) throw new Error("stripe_checkout_preflight_invalid");
    const status = text(row.status);
    if (!LIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status)) throw new Error("stripe_checkout_preflight_invalid");
    return LIVE_STATUSES.has(status);
  });
}

export type StripeCheckoutPreflightResult = {
  customerId: string | null;
  existingSubscription: { id: string; customerId: string; status: string; priceId: string | null } | null;
};

/** Read-only recovery for an active complimentary account with no subscription ID. */
export async function inspectComplimentaryCheckout(input: {
  userId: string;
  customerId: string | null;
  emails: Array<string | null | undefined>;
  get: (path: string) => Promise<unknown>;
  hasOtherOwner: (customerIds: string[], subscriptionIds: string[]) => Promise<boolean>;
}): Promise<StripeCheckoutPreflightResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.userId)) throw new Error("stripe_checkout_preflight_invalid");
  let requestCount = 0;
  const get = async (path: string) => {
    if (++requestCount > 30) throw new Error("stripe_checkout_preflight_limit");
    return input.get(path);
  };
  const customers = new Map<string, StripeObject>();
  const addCustomer = (raw: StripeObject) => {
    const customerId = id(raw.id, "cus_");
    if (raw.deleted) throw new Error("stripe_checkout_preflight_invalid");
    customers.set(customerId, raw);
  };
  if (input.customerId) {
    const customer = object(await get(`/customers/${encodeURIComponent(id(input.customerId, "cus_"))}`));
    if (id(customer.id, "cus_") !== input.customerId) throw new Error("stripe_checkout_preflight_invalid");
    addCustomer(customer);
  } else {
    // Exact email lists are live reads. Search additionally recovers old customer
    // references after an email change; it is never used as a read-after-write check.
    const emails = [...new Set(input.emails.map((email) => text(email)).filter(Boolean))];
    if (!emails.length || emails.length > 4) throw new Error("stripe_checkout_preflight_invalid");
    for (const email of emails) {
      const rows = await listStripeObjects(get, "/customers", { email });
      rows.forEach(addCustomer);
    }
    let pageToken = "";
    const seenTokens = new Set<string>();
    for (let pageNumber = 0; ; pageNumber += 1) {
      const query = new URLSearchParams({ query: `metadata['user_id']:'${input.userId}'`, limit: "100" });
      if (pageToken) query.set("page", pageToken);
      const page = object(await get(`/customers/search?${query}`));
      if (!Array.isArray(page.data) || typeof page.has_more !== "boolean") throw new Error("stripe_checkout_preflight_invalid");
      page.data.map(object).forEach(addCustomer);
      if (!page.has_more) break;
      pageToken = text(page.next_page);
      if (!pageToken || seenTokens.has(pageToken) || pageNumber + 1 >= MAX_PAGES) throw new Error("stripe_checkout_preflight_limit");
      seenTokens.add(pageToken);
    }
  }

  const trustedCustomerIds: string[] = [];
  const live: NonNullable<StripeCheckoutPreflightResult["existingSubscription"]>[] = [];
  for (const [customerId, customer] of customers) {
    const customerOwner = owner(customer);
    const trusted = customerId === input.customerId || customerOwner === input.userId;
    const subscriptions = await findLiveStripeSubscriptions(customerId, get);
    if (customerOwner && customerOwner !== input.userId) {
      if (trusted || subscriptions.length) throw new Error("stripe_checkout_identity_ambiguous");
      continue;
    }
    if (trusted) trustedCustomerIds.push(customerId);
    for (const subscription of subscriptions) {
      const subscriptionOwner = owner(subscription);
      if ((!trusted && subscriptionOwner !== input.userId) || (subscriptionOwner && subscriptionOwner !== input.userId)) {
        throw new Error("stripe_checkout_identity_ambiguous");
      }
      const items = subscription.items ? object(subscription.items) : null;
      const firstItem = items && Array.isArray(items.data) && items.data.length === 1 ? object(items.data[0]) : null;
      const price = firstItem?.price && typeof firstItem.price === "object" ? object(firstItem.price) : null;
      live.push({ id: id(subscription.id, "sub_"), customerId, status: text(subscription.status), priceId: text(price?.id) || null });
    }
  }
  if (live.length > 1) throw new Error("stripe_checkout_identity_ambiguous");
  const existingSubscription = live[0] ?? null;
  const customerId = existingSubscription?.customerId ?? input.customerId ??
    (trustedCustomerIds.length === 1 ? trustedCustomerIds[0] : null);
  const relevantCustomers = [...new Set([...trustedCustomerIds, ...(customerId ? [customerId] : [])])];
  if (relevantCustomers.length && await input.hasOtherOwner(relevantCustomers, live.map((subscription) => subscription.id))) {
    throw new Error("stripe_checkout_identity_ambiguous");
  }
  return { customerId, existingSubscription };
}
