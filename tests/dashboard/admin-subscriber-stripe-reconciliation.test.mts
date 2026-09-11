import assert from "node:assert/strict";
import test from "node:test";

import {
  matchAdminSubscribersToStripe,
  overlaySubscriptionWithStripe,
  stripeAdminSubscriberSnapshot,
  stripeSubscriptionMonthlyTerms,
  type AdminSubscriberReconciliationRecord,
} from "../../lib/adminSubscriberStripe.ts";
import {
  collectStripeListPages,
  collectSupabaseKeysetPages,
} from "../../lib/adminSubscriberPagination.ts";
import type {
  AdminSubscriberProfileRow,
  AdminSubscriberSubscriptionRow,
} from "../../lib/adminSubscribers.ts";

function stripeSubscription(input: {
  id: string;
  customerId?: string;
  name?: string;
  email?: string;
  status?: string;
  amountEur?: number;
  metadataUserId?: string;
  customerMetadataUserId?: string;
  interval?: "month" | "year";
}) {
  const interval = input.interval ?? "month";
  const monthly = input.amountEur ?? 69;
  return {
    id: input.id,
    object: "subscription",
    livemode: true,
    status: input.status ?? "active",
    created: 1_789_000_000,
    current_period_end: 1_791_590_400,
    metadata: input.metadataUserId ? { user_id: input.metadataUserId } : {},
    customer: {
      id: input.customerId ?? `cus_${input.id}`,
      name: input.name ?? null,
      email: input.email ?? null,
      phone: null,
      metadata: input.customerMetadataUserId
        ? { user_id: input.customerMetadataUserId }
        : {},
    },
    items: {
      data: [
        {
          quantity: 1,
          price: {
            id: `price_${input.id}`,
            currency: "eur",
            billing_scheme: "per_unit",
            unit_amount: monthly * (interval === "year" ? 12 : 1) * 100,
            recurring: { interval, interval_count: 1, usage_type: "licensed" },
          },
        },
      ],
    },
  };
}

function localRecord(input: {
  userId: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  status?: string;
  amountEur?: number;
  provider?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
}): AdminSubscriberReconciliationRecord {
  const subscription: AdminSubscriberSubscriptionRow = {
    user_id: input.userId,
    contact_email: input.email ?? null,
    plan: "Standard",
    status: input.status ?? "active",
    monthly_price_eur: input.amountEur ?? 0,
    billing_cycle: "monthly",
    billing_provider: input.provider ?? null,
    stripe_customer_id: input.customerId ?? null,
    stripe_subscription_id: input.subscriptionId ?? null,
    stripe_price_id: null,
    last_reminder_at: null,
    next_renewal_date: null,
  };
  const profile: AdminSubscriberProfileRow = {
    user_id: input.userId,
    admin_email: input.email ?? null,
    contact_email: null,
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    company_legal_name: input.company ?? null,
    phone: null,
  };
  return { subscription, profile };
}

function snapshots(values: unknown[]) {
  return values.map(stripeAdminSubscriberSnapshot).filter((value) => value !== null);
}

test("les trois cas production sont rapprochés sans fuzzy matching", () => {
  const records = [
    localRecord({
      userId: "anthony",
      firstName: "anthony",
      lastName: "desanlis",
      company: "myautoplus",
      email: "myautoplus51@gmail.com",
    }),
    localRecord({
      userId: "agira",
      firstName: "Luigi",
      lastName: "Chiovetta",
      company: "Agira Batiments",
      email: "agirabatiments92@gmail.com",
    }),
    localRecord({
      userId: "fv",
      firstName: "Florian",
      lastName: "Vitse",
      company: "FV Couverture",
      email: "fv.couv@gmail.com",
      amountEur: 359,
    }),
  ];
  const stripe = snapshots([
    stripeSubscription({
      id: "sub_anthony",
      customerId: "cus_anthony",
      name: "Desanlis",
      email: "myautoplus@outlook.fr",
      amountEur: 240,
    }),
    stripeSubscription({
      id: "sub_agira",
      customerId: "cus_agira",
      name: "AGIRA BATIMENTS",
      email: "piouerica@gmail.com",
      amountEur: 359,
    }),
    stripeSubscription({
      id: "sub_fv",
      customerId: "cus_fv",
      name: "FV Couverture - Florian Vitse",
      email: "florian.vitse@gmail.com",
      status: "past_due",
      amountEur: 259,
    }),
  ]);

  const result = matchAdminSubscribersToStripe(records, stripe);
  assert.equal(result.matchesByUserId.get("anthony")?.method, "multi_signal");
  assert.equal(result.matchesByUserId.get("anthony")?.write_safe, true);
  assert.equal(result.matchesByUserId.get("agira")?.method, "company_exact");
  assert.equal(result.matchesByUserId.get("agira")?.write_safe, false);
  assert.equal(result.matchesByUserId.get("fv")?.method, "multi_signal");
  assert.equal(result.matchesByUserId.get("fv")?.write_safe, true);

  const fv = overlaySubscriptionWithStripe(
    records[2].subscription,
    result.matchesByUserId.get("fv")!.snapshot,
  );
  assert.equal(fv.status, "past_due");
  assert.equal(fv.monthly_price_eur, 259);
  assert.equal(
    overlaySubscriptionWithStripe(
      records[0].subscription,
      result.matchesByUserId.get("anthony")!.snapshot,
    ).monthly_price_eur,
    240,
  );
});

test("IDs et metadata ont priorité, mais toute metadata contradictoire ferme le match", () => {
  const exact = localRecord({
    userId: "user-a",
    company: "Entreprise Partagée",
    subscriptionId: "sub_exact",
  });
  const weakCollision = localRecord({ userId: "user-b", company: "Entreprise Partagée" });
  const clean = stripeAdminSubscriberSnapshot(
    stripeSubscription({ id: "sub_exact", name: "Entreprise Partagée" }),
  )!;
  const other = stripeAdminSubscriberSnapshot(
    stripeSubscription({ id: "sub_other", name: "Entreprise Partagée" }),
  )!;
  const precedence = matchAdminSubscribersToStripe([exact, weakCollision], [clean, other]);
  assert.equal(precedence.matchesByUserId.get("user-a")?.method, "subscription_id");

  const contradictory = stripeAdminSubscriberSnapshot(
    stripeSubscription({
      id: "sub_exact",
      metadataUserId: "user-b",
      customerMetadataUserId: "user-b",
    }),
  )!;
  const conflict = matchAdminSubscribersToStripe([exact], [contradictory]);
  assert.equal(conflict.matchesByUserId.has("user-a"), false);
  assert.equal(conflict.ambiguousUserIds.has("user-a"), true);

  const conflictingMetadata = stripeAdminSubscriberSnapshot(
    stripeSubscription({
      id: "sub_conflicting_metadata",
      metadataUserId: "user-a",
      customerMetadataUserId: "user-b",
    }),
  )!;
  assert.equal(conflictingMetadata.identity_conflict, true);
  const rejected = matchAdminSubscribersToStripe([exact], [conflictingMetadata]);
  assert.equal(rejected.matchesByUserId.size, 0);

  const linkedWithSharedCustomerMetadata = stripeAdminSubscriberSnapshot(
    stripeSubscription({
      id: "sub_exact",
      metadataUserId: "user-a",
      customerMetadataUserId: "other-customer-account",
    }),
  )!;
  const sharedCustomerHint = matchAdminSubscribersToStripe(
    [exact],
    [linkedWithSharedCustomerMetadata],
  );
  assert.equal(sharedCustomerHint.matchesByUserId.get("user-a")?.method, "subscription_id");
});

test("un propriétaire local explicite met en quarantaine une metadata Stripe vers un autre compte", () => {
  const metadataOwner = localRecord({ userId: "user-a" });
  const subscriptionOwner = localRecord({
    userId: "user-b",
    subscriptionId: "sub_owned",
  });
  const customerOwner = localRecord({
    userId: "user-c",
    customerId: "cus_owned",
  });
  const ownedBySubscription = stripeAdminSubscriberSnapshot(
    stripeSubscription({
      id: "sub_owned",
      customerId: "cus_unrelated",
      metadataUserId: "user-a",
    }),
  )!;
  const first = matchAdminSubscribersToStripe(
    [metadataOwner, subscriptionOwner],
    [ownedBySubscription],
  );
  assert.equal(first.matchesByUserId.size, 0);
  assert.deepEqual(
    Array.from(first.ambiguousUserIds).sort(),
    ["user-a", "user-b"],
  );

  const ownedByCustomer = stripeAdminSubscriberSnapshot(
    stripeSubscription({
      id: "sub_customer_owned",
      customerId: "cus_owned",
      metadataUserId: "user-a",
    }),
  )!;
  const second = matchAdminSubscribersToStripe(
    [metadataOwner, customerOwner],
    [ownedByCustomer],
  );
  assert.equal(second.matchesByUserId.size, 0);
  assert.deepEqual(
    Array.from(second.ambiguousUserIds).sort(),
    ["user-a", "user-c"],
  );
});

test("un customer Stripe partagé ne casse pas deux sub IDs/metadata cohérents", () => {
  const records = [
    localRecord({
      userId: "shared-a",
      subscriptionId: "sub_shared_a",
      customerId: "cus_shared",
    }),
    localRecord({
      userId: "shared-b",
      subscriptionId: "sub_shared_b",
      customerId: "cus_shared",
    }),
  ];
  const stripe = snapshots([
    stripeSubscription({
      id: "sub_shared_a",
      customerId: "cus_shared",
      metadataUserId: "shared-a",
    }),
    stripeSubscription({
      id: "sub_shared_b",
      customerId: "cus_shared",
      metadataUserId: "shared-b",
    }),
  ]);
  const result = matchAdminSubscribersToStripe(records, stripe);
  assert.equal(result.matchesByUserId.get("shared-a")?.snapshot.subscription_id, "sub_shared_a");
  assert.equal(result.matchesByUserId.get("shared-b")?.snapshot.subscription_id, "sub_shared_b");
  assert.equal(result.ambiguousUserIds.size, 0);

  const transitional = [
    localRecord({ userId: "transition-a", subscriptionId: "sub_transition_a" }),
    localRecord({ userId: "transition-b", customerId: "cus_transition" }),
  ];
  const transitionalStripe = snapshots([
    stripeSubscription({
      id: "sub_transition_a",
      customerId: "cus_transition",
      metadataUserId: "transition-a",
    }),
  ]);
  const transitionalResult = matchAdminSubscribersToStripe(
    transitional,
    transitionalStripe,
  );
  assert.equal(
    transitionalResult.matchesByUserId.get("transition-a")?.snapshot.subscription_id,
    "sub_transition_a",
  );
});

test("collisions, metadata orpheline et provider natif ne produisent aucun faux positif", () => {
  const duplicated = [
    localRecord({ userId: "one", company: "Agira Batiments" }),
    localRecord({ userId: "two", company: "Agira Batiments" }),
  ];
  const agira = stripeAdminSubscriberSnapshot(
    stripeSubscription({ id: "sub_agira", name: "Agira Batiments" }),
  )!;
  const collision = matchAdminSubscribersToStripe(duplicated, [agira]);
  assert.equal(collision.matchesByUserId.size, 0);
  assert.equal(collision.ambiguousUserIds.size, 2);

  const orphanMetadata = stripeAdminSubscriberSnapshot(
    stripeSubscription({
      id: "sub_orphan",
      name: "Agira Batiments",
      metadataUserId: "unknown-user",
    }),
  )!;
  const orphan = matchAdminSubscribersToStripe([duplicated[0]], [orphanMetadata]);
  assert.equal(orphan.matchesByUserId.size, 0);
  assert.equal(orphan.ambiguousUserIds.has("one"), true);

  const native = localRecord({
    userId: "native",
    company: "Agira Batiments",
    provider: "app_store",
  });
  const protectedNative = matchAdminSubscribersToStripe([native], [agira]);
  assert.equal(protectedNative.matchesByUserId.size, 0);
  assert.equal(protectedNative.unmatchedStripeSubscriptionIds.has("sub_agira"), true);
});

test("un nom société/personne non délimité ne fabrique pas une convergence", () => {
  const local = localRecord({
    userId: "maison-dupont",
    firstName: "Florian",
    lastName: "Dupont",
    company: "Maison Dupont",
  });
  const stripe = stripeAdminSubscriberSnapshot(
    stripeSubscription({ id: "sub_maison", name: "Maison Dupont" }),
  )!;
  const result = matchAdminSubscribersToStripe([local], [stripe]);
  assert.equal(result.matchesByUserId.get("maison-dupont")?.method, "company_exact");
  assert.equal(result.matchesByUserId.get("maison-dupont")?.write_safe, false);

  const duplicatedKey = localRecord({
    userId: "dupont",
    lastName: "Dupont",
    company: "Dupont",
  });
  const duplicatedKeyStripe = stripeAdminSubscriberSnapshot(
    stripeSubscription({ id: "sub_dupont", name: "Dupont" }),
  )!;
  const duplicatedKeyResult = matchAdminSubscribersToStripe(
    [duplicatedKey],
    [duplicatedKeyStripe],
  );
  assert.equal(duplicatedKeyResult.matchesByUserId.get("dupont")?.write_safe, false);
});

test("un email, customer id ou metadata exacts et uniques sont persistables", () => {
  const email = localRecord({ userId: "email-user", email: "client@example.com" });
  const customer = localRecord({ userId: "customer-user", customerId: "cus_known" });
  const metadata = localRecord({ userId: "metadata-user" });
  const result = matchAdminSubscribersToStripe(
    [email, customer, metadata],
    snapshots([
      stripeSubscription({ id: "sub_email", email: "CLIENT@example.com" }),
      stripeSubscription({ id: "sub_customer", customerId: "cus_known" }),
      stripeSubscription({ id: "sub_metadata", metadataUserId: "metadata-user" }),
    ]),
  );
  assert.equal(result.matchesByUserId.get("email-user")?.method, "email");
  assert.equal(result.matchesByUserId.get("customer-user")?.method, "customer_id");
  assert.equal(result.matchesByUserId.get("metadata-user")?.method, "metadata_user_id");
  assert.equal(
    Array.from(result.matchesByUserId.values()).every((match) => match.write_safe),
    true,
  );

  const customerMetadataOnly = matchAdminSubscribersToStripe(
    [localRecord({ userId: "customer-metadata-only" })],
    snapshots([
      stripeSubscription({
        id: "sub_customer_metadata_only",
        customerMetadataUserId: "customer-metadata-only",
      }),
    ]),
  );
  assert.equal(customerMetadataOnly.matchesByUserId.size, 0);
});

test("le montant mensuel additionne items/quantité et normalise cadence/interval_count", () => {
  const terms = stripeSubscriptionMonthlyTerms({
    items: {
      data: [
        {
          quantity: 2,
          price: {
            id: "price_month",
            currency: "eur",
            unit_amount_decimal: "10000",
            recurring: { interval: "month", interval_count: 2, usage_type: "licensed" },
          },
        },
        {
          quantity: 1,
          price: {
            id: "price_year",
            currency: "eur",
            unit_amount: 168000,
            recurring: { interval: "year", interval_count: 2, usage_type: "licensed" },
          },
        },
      ],
    },
  });
  assert.equal(terms.amountEur, 170); // 2*100/2 + 1680/(12*2)
  assert.equal(terms.billingCycle, "mixed");

  assert.deepEqual(
    stripeSubscriptionMonthlyTerms({
      items: {
        data: [{
          quantity: 1,
          price: {
            currency: "eur",
            unit_amount: 24000,
            recurring: { interval: "month", interval_count: 2 },
          },
        }],
      },
    }),
    { amountEur: 120, billingCycle: "other", priceId: null },
  );
  assert.equal(
    stripeSubscriptionMonthlyTerms({
      items: {
        data: [{
          quantity: 1,
          price: {
            currency: "eur",
            unit_amount: 73000,
            recurring: { interval: "year", interval_count: 1 },
          },
        }],
      },
    }).amountEur,
    60.83,
  );

  for (const price of [
    { currency: "usd", unit_amount: 24000, recurring: { interval: "month" } },
    { currency: "eur", billing_scheme: "tiered", recurring: { interval: "month" } },
    { currency: "eur", unit_amount: 24000, recurring: { interval: "month", usage_type: "metered" } },
  ]) {
    assert.equal(
      stripeSubscriptionMonthlyTerms({ items: { data: [{ quantity: 1, price }] } }).amountEur,
      null,
    );
  }
  assert.equal(
    stripeSubscriptionMonthlyTerms({
      items: {
        has_more: true,
        data: [{
          quantity: 1,
          price: {
            currency: "eur",
            unit_amount: 24000,
            recurring: { interval: "month" },
          },
        }],
      },
    }).amountEur,
    null,
  );
});

test("la prochaine échéance est la première date fiable, jamais une page d'items partielle", () => {
  const base = stripeSubscription({ id: "sub_period", amountEur: 100 });
  const complete = {
    ...base,
    current_period_end: 0,
    items: {
      ...base.items,
      data: [
        { ...base.items.data[0], current_period_end: 1_800_000_000 },
        { ...base.items.data[0], current_period_end: 1_790_000_000 },
      ],
    },
  };
  assert.equal(
    stripeAdminSubscriberSnapshot(complete)?.next_renewal_date,
    new Date(1_790_000_000 * 1_000).toISOString().slice(0, 10),
  );

  const partial = { ...complete, items: { ...complete.items, has_more: true } };
  const partialSnapshot = stripeAdminSubscriberSnapshot(partial);
  assert.equal(partialSnapshot?.amount_eur, null);
  assert.equal(partialSnapshot?.next_renewal_date, null);
});

test("le parseur live refuse le mode test, mais le calcul webhook reste utilisable en staging", () => {
  const testMode = { ...stripeSubscription({ id: "sub_test", amountEur: 240 }), livemode: false };
  assert.equal(stripeAdminSubscriberSnapshot(testMode), null);
  assert.equal(stripeSubscriptionMonthlyTerms(testMode).amountEur, 240);
});

test("pagination Stripe 205 éléments et Supabase >1000 sans troncature", async () => {
  const stripeRows = Array.from({ length: 205 }, (_, index) => ({ id: `sub_${index}` }));
  const cursors: Array<string | null> = [];
  const stripe = await collectStripeListPages({
    fetchPage: async (startingAfter, limit) => {
      cursors.push(startingAfter);
      const start = startingAfter
        ? stripeRows.findIndex((row) => row.id === startingAfter) + 1
        : 0;
      const data = stripeRows.slice(start, start + limit);
      return { data, hasMore: start + data.length < stripeRows.length };
    },
    getId: (row) => row.id,
  });
  assert.equal(stripe.pages, 3);
  assert.equal(stripe.rows.length, 205);
  assert.deepEqual(cursors, [null, "sub_99", "sub_199"]);

  const supabaseRows = Array.from(
    { length: 1_205 },
    (_, index) => ({ user_id: `user-${String(index).padStart(5, "0")}` }),
  );
  const supabaseCursors: Array<string | null> = [];
  const supabase = await collectSupabaseKeysetPages<{ user_id: string }>({
    pageSize: 500,
    getCursor: (row) => row.user_id,
    fetchPage: async (after, limit) => {
      supabaseCursors.push(after);
      const start = after
        ? supabaseRows.findIndex((row) => row.user_id === after) + 1
        : 0;
      return supabaseRows.slice(start, start + limit);
    },
  });
  assert.equal(supabase.pages, 3);
  assert.equal(supabase.rows.length, 1_205);
  assert.deepEqual(supabaseCursors, [null, "user-00499", "user-00999"]);
});

test("pagination fail-closed si Stripe annonce une suite sans cursor", async () => {
  await assert.rejects(
    collectStripeListPages({
      fetchPage: async () => ({ data: [] as Array<{ id: string }>, hasMore: true }),
      getId: (row) => row.id,
    }),
    /stripe_pagination_missing_cursor/,
  );
});
