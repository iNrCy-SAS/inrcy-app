import assert from "node:assert/strict";
import test from "node:test";
import {
  activateOpenaiAdsCampaign,
  assessOpenaiAdsAccount,
  createPausedOpenaiAdsCampaign,
  isOpenaiAdsPublishProgress,
  OpenaiAdsPublishError,
  openaiAdsReviewAllowsActivation,
  readOpenaiAdsCampaignState,
  resolveOpenaiAdsLocations,
  setOpenaiAdsCampaignPaused,
  verifyOpenaiAdsAccount,
  type OpenaiAdsPublishRequest,
} from "../lib/adsOpenaiConnector.ts";

const baseRequest: OpenaiAdsPublishRequest = {
  operationId: "draft-1a2b3c4d",
  expectedAccountId: "adacct_123",
  campaignName: "Plombier Lille",
  biddingType: "clicks",
  budget: { dailySpendLimitMicros: 15_000_000 },
  targetLocations: ["Lille"],
  countryCode: "FR",
  adGroupName: "Dépannage plomberie",
  contextHints: ["Dépannage de fuite d'eau à Lille"],
  maxBidMicros: 1_000_000,
  adName: "Fuite d'eau Lille",
  title: "Plombier à Lille",
  body: "Une fuite d'eau ? Demandez une intervention locale.",
  destinationUrl: "https://example.fr/plomberie-lille",
  mediaStableId: "174dc871-f583-4ad1-a47c-4b49e992d58b",
  imageUrl: "https://example.fr/images/plombier-square.png",
};

type Call = { url: URL; init: RequestInit; body: Record<string, unknown> };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function mockAdsApi(options: {
  locationResults?: unknown[];
  account?: Record<string, unknown>;
  reviewStatus?: string;
  resourceStatus?: "active" | "paused";
  onCall?: (call: Call) => Response | undefined;
} = {}) {
  const calls: Call[] = [];
  let campaignStatus = options.resourceStatus || "paused";
  let adGroupStatus = options.resourceStatus || "paused";
  let adStatus = options.resourceStatus || "paused";
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(String(input)),
      init,
      body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    };
    calls.push(call);
    const overridden = options.onCall?.(call);
    if (overridden) return overridden;
    const path = call.url.pathname.replace(/^\/v1/, "");
    if (path === "/ad_account") return json({
      id: "adacct_123", name: "Entreprise", currency_code: "EUR", timezone: "Europe/Paris",
      status: "active", review: { status: "approved" }, ...options.account,
    });
    if (path === "/geo_lookup/search") return json({ query: call.url.searchParams.get("q"), count: 1,
      results: options.locationResults || [{ id: "geo_lille", name: "Lille", canonical_name: "Lille, Hauts-de-France, France", type: "city", country_code: "FR" }],
    });
    if (path === "/campaigns" && call.init.method === "POST") return json({ id: "cmpn_123", status: "paused" });
    if (path === "/ad_groups" && call.init.method === "POST") return json({ id: "adgrp_123", status: "paused" });
    if (path === "/upload") return json({ file_id: "file_123" });
    if (path === "/ads" && call.init.method === "POST") return json({ id: "ad_123", status: "paused" });
    if (path === "/campaigns/cmpn_123" && call.init.method === "GET") return json({ id: "cmpn_123", status: campaignStatus });
    // The published OpenAPI response schemas do not require parent IDs here.
    if (path === "/ad_groups/adgrp_123" && call.init.method === "GET") return json({ id: "adgrp_123", status: adGroupStatus });
    if (path === "/ads/ad_123" && call.init.method === "GET") return json({ id: "ad_123", status: adStatus, review_status: options.reviewStatus || "in_review" });
    if (path === "/ads/ad_123/activate") { adStatus = "active"; return json({ status: "active" }); }
    if (path === "/ad_groups/adgrp_123/activate") { adGroupStatus = "active"; return json({ status: "active" }); }
    if (path === "/campaigns/cmpn_123/activate") { campaignStatus = "active"; return json({ status: "active" }); }
    if (path === "/campaigns/cmpn_123/pause") { campaignStatus = "paused"; return json({ status: "paused" }); }
    return json({ error: { code: "unexpected_call" } }, 404);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("la clé Ads est liée au bon compte, avec revues lisibles sans inventer la facturation", async () => {
  const api = mockAdsApi({ account: { account_integrity_review: { review: { status: "pending" } } } });
  const account = await verifyOpenaiAdsAccount({ apiKey: "secret", expectedAccountId: "adacct_123", fetchImpl: api.fetchImpl });
  assert.equal(account.id, "adacct_123");
  assert.equal(account.currencyCode, "EUR");
  assert.equal(account.brandReviewStatus, "approved");
  assert.equal(account.accountReviewStatus, "pending");
  assert.equal(assessOpenaiAdsAccount(account).ready, false);
  await assert.rejects(
    verifyOpenaiAdsAccount({ apiKey: "secret", expectedAccountId: "adacct_other", fetchImpl: api.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "ACCOUNT_MISMATCH",
  );
  assert.equal(api.calls.length, 2);
});

test("les zones doivent être exactes, françaises et non ambiguës", async () => {
  const api = mockAdsApi({ locationResults: [
    { id: "geo_1", name: "Saint-Omer", canonical_name: "Saint-Omer, France", type: "city", country_code: "FR" },
    { id: "geo_2", name: "Saint-Omer", canonical_name: "Saint-Omer, France", type: "market", country_code: "FR" },
  ] });
  await assert.rejects(
    resolveOpenaiAdsLocations({ apiKey: "secret", names: ["Saint-Omer"], countryCode: "FR", fetchImpl: api.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "UNRESOLVED_GEO",
  );
  const country = mockAdsApi({ locationResults: [
    { id: "geo_fr", name: "France", canonical_name: "France", type: "country", country_code: "FR" },
  ] });
  await assert.rejects(
    resolveOpenaiAdsLocations({ apiKey: "secret", names: ["France"], countryCode: "FR", fetchImpl: country.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "UNRESOLVED_GEO",
  );
});

test("une campagne complète est créée en pause, avec géos vérifiées et clés de reprise distinctes", async () => {
  const api = mockAdsApi();
  const saved: string[] = [];
  const progress = await createPausedOpenaiAdsCampaign({
    apiKey: "secret", request: baseRequest, fetchImpl: api.fetchImpl,
    onProgress: async (value) => { saved.push(value.stage); },
  });
  assert.equal(progress.stage, "paused");
  assert.deepEqual(saved, ["verified", "campaign_created", "ad_group_created", "image_uploaded", "ad_created", "paused"]);
  assert.equal(isOpenaiAdsPublishProgress(progress), true);
  const writes = api.calls.filter((call) => call.init.method === "POST");
  assert.deepEqual(writes.map((call) => call.url.pathname), ["/v1/campaigns", "/v1/ad_groups", "/v1/upload", "/v1/ads"]);
  assert.deepEqual(writes.map((call) => (call.init.headers as Record<string, string>)["Idempotency-Key"] || null), [
    "draft-1a2b3c4d-campaign", "draft-1a2b3c4d-ad-group", null, "draft-1a2b3c4d-ad",
  ]);
  assert.equal(writes[0].body.status, "paused");
  assert.deepEqual((writes[0].body.targeting as {locations:{include:unknown[]}}).locations.include, [{ id: "geo_lille" }]);
  assert.equal(writes[1].body.status, "paused");
  assert.equal(writes[3].body.status, "paused");
  assert.deepEqual(writes[3].body.creative, {
    type: "chat_card", title: baseRequest.title, body: baseRequest.body,
    target_url: baseRequest.destinationUrl, file_id: "file_123",
  });
  assert.equal(api.calls.some((call) => call.url.pathname.endsWith("/activate")), false);
});

test("une image absente ou une revue compte incomplète empêche toute création", async () => {
  const noImage = mockAdsApi();
  await assert.rejects(
    createPausedOpenaiAdsCampaign({ apiKey: "secret", request: { ...baseRequest, imageUrl: "" }, fetchImpl: noImage.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "INVALID_CREATIVE",
  );
  assert.equal(noImage.calls.length, 0);
  const pending = mockAdsApi({ account: { review: { status: "in_review" } } });
  await assert.rejects(
    createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: pending.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "ACCOUNT_IN_REVIEW",
  );
  assert.deepEqual(pending.calls.map((call) => call.url.pathname), ["/v1/ad_account"]);
});

test("l’enchère fixe ne peut pas dépasser le budget quotidien", async () => {
  const api = mockAdsApi();
  await assert.rejects(
    createPausedOpenaiAdsCampaign({
      apiKey: "secret", request: { ...baseRequest, maxBidMicros: 16_000_000 }, fetchImpl: api.fetchImpl,
    }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "INVALID_BID",
  );
  assert.equal(api.calls.length, 0);
});

test("un lien parent incohérent, s’il est renvoyé, bloque la confirmation", async () => {
  const api = mockAdsApi({ onCall: (call) => call.url.pathname === "/v1/ad_groups/adgrp_123" && call.init.method === "GET"
    ? json({ id: "adgrp_123", campaign_id: "cmpn_wrong", status: "paused" }) : undefined });
  await assert.rejects(
    createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: api.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "PROVIDER_STATE_MISMATCH" && error.progress?.adId === "ad_123",
  );
});

test("une panne de stockage après la première mutation garde les mêmes clés d’idempotence au retry", async () => {
  const api = mockAdsApi();
  let saved: unknown;
  await assert.rejects(
    createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: api.fetchImpl,
      onProgress: async (value) => {
        saved = value;
        if (value.stage === "campaign_created") throw new Error("database unavailable");
      },
    }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.mutationStarted && error.progress?.campaignId === "cmpn_123",
  );
  assert.equal(isOpenaiAdsPublishProgress(saved), true);
  await createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: api.fetchImpl });
  const campaignWrites = api.calls.filter((call) => call.url.pathname === "/v1/campaigns");
  assert.equal(campaignWrites.length, 2);
  assert.equal((campaignWrites[0].init.headers as Record<string,string>)["Idempotency-Key"],
    (campaignWrites[1].init.headers as Record<string,string>)["Idempotency-Key"]);
});

test("un 400 explicite au premier POST reste corrigeable, une réponse perdue non", async () => {
  const rejected = mockAdsApi({ onCall: (call) => call.url.pathname === "/v1/campaigns" && call.init.method === "POST"
    ? json({ error: { code: "invalid_request" } }, 400) : undefined });
  await assert.rejects(
    createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: rejected.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.retrySafe && error.httpStatus === 400 && !error.progress?.campaignId,
  );
  const uncertain = mockAdsApi({ onCall: (call) => {
    if (call.url.pathname === "/v1/campaigns" && call.init.method === "POST") throw new Error("lost response");
    return undefined;
  } });
  await assert.rejects(
    createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: uncertain.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && !error.retrySafe && error.code === "NETWORK_UNCERTAIN",
  );
});

test("la reprise refuse un brouillon modifié avant toute mutation", async () => {
  const api = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: api.fetchImpl });
  const another = mockAdsApi();
  await assert.rejects(
    createPausedOpenaiAdsCampaign({ apiKey: "secret", request: { ...baseRequest, body: "Un autre message" }, progress, fetchImpl: another.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "PROGRESS_MISMATCH",
  );
  assert.equal(another.calls.length, 0);
});

test("une nouvelle URL signée du même média permet la reprise", async () => {
  const api = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: api.fetchImpl });
  const resumed = mockAdsApi();
  const result = await createPausedOpenaiAdsCampaign({
    apiKey: "secret", request: { ...baseRequest, imageUrl: "https://example.fr/images/plombier-square.png?token=new" },
    progress, fetchImpl: resumed.fetchImpl,
  });
  assert.equal(result.stage, "paused");
  assert.equal(resumed.calls.some((call) => call.init.method === "POST"), false);
  await assert.rejects(
    createPausedOpenaiAdsCampaign({
      apiKey: "secret", request: { ...baseRequest, mediaStableId: "8ed11a27-c531-493e-91a0-cc21c0b78c08" },
      progress, fetchImpl: resumed.fetchImpl,
    }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "PROGRESS_MISMATCH",
  );
});

test("activation distincte : facturation confirmée, revue recevable et campagne activée en dernier", async () => {
  const creationApi = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({ apiKey: "secret", request: baseRequest, fetchImpl: creationApi.fetchImpl });
  const blocked = mockAdsApi();
  await assert.rejects(
    activateOpenaiAdsCampaign({ apiKey: "secret", progress, expectedAccountId: "adacct_123", billingConfirmed: false, fetchImpl: blocked.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "BILLING_UNCONFIRMED",
  );
  assert.equal(blocked.calls.length, 0);
  const rejected = mockAdsApi({ reviewStatus: "rejected" });
  await assert.rejects(
    activateOpenaiAdsCampaign({ apiKey: "secret", progress, expectedAccountId: "adacct_123", billingConfirmed: true, fetchImpl: rejected.fetchImpl }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "REVIEW_OR_STATE_BLOCKED",
  );
  assert.equal(rejected.calls.some((call) => call.init.method === "POST"), false);
  const inReview = mockAdsApi();
  const active = await activateOpenaiAdsCampaign({ apiKey: "secret", progress, expectedAccountId: "adacct_123", billingConfirmed: true, fetchImpl: inReview.fetchImpl });
  assert.equal(active.stage, "active");
  assert.deepEqual(inReview.calls.filter((call) => call.init.method === "POST").map((call) => call.url.pathname), [
    "/v1/ads/ad_123/activate", "/v1/ad_groups/adgrp_123/activate", "/v1/campaigns/cmpn_123/activate",
  ]);
  assert.equal(openaiAdsReviewAllowsActivation("approved"), true);
  assert.equal(openaiAdsReviewAllowsActivation("in_review"), true);
  assert.equal(openaiAdsReviewAllowsActivation("rejected"), false);
  assert.equal(openaiAdsReviewAllowsActivation(""), false);
});

test("un compte repassé inactif ou en revue reste lisible et peut être mis en pause d’urgence", async () => {
  const creation = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({
    apiKey: "secret", request: baseRequest, fetchImpl: creation.fetchImpl,
  });
  const noLongerReady = mockAdsApi({
    resourceStatus: "active",
    reviewStatus: "approved",
    account: { status: "paused", review: { status: "in_review" } },
  });
  const paused = await setOpenaiAdsCampaignPaused({
    apiKey: "secret", progress, expectedAccountId: "adacct_123", paused: true,
    fetchImpl: noLongerReady.fetchImpl,
  });
  assert.equal(paused.stage, "paused");
  assert.deepEqual(
    noLongerReady.calls.filter((call) => call.init.method === "POST").map((call) => call.url.pathname),
    ["/v1/campaigns/cmpn_123/pause"],
  );
  const activation = mockAdsApi({
    resourceStatus: "paused",
    reviewStatus: "approved",
    account: { status: "paused", review: { status: "in_review" } },
  });
  await assert.rejects(
    activateOpenaiAdsCampaign({
      apiKey: "secret", progress, expectedAccountId: "adacct_123", billingConfirmed: true,
      fetchImpl: activation.fetchImpl,
    }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "ACCOUNT_NOT_ACTIVE" && !error.mutationStarted,
  );
  assert.equal(activation.calls.some((call) => call.init.method === "POST"), false);
});

test("une réponse perdue pendant l’activation impose une resynchronisation distante", async () => {
  const creation = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({
    apiKey: "secret", request: baseRequest, fetchImpl: creation.fetchImpl,
  });
  const uncertain = mockAdsApi({
    reviewStatus: "approved",
    onCall: (call) => {
      if (call.url.pathname === "/v1/campaigns/cmpn_123/activate") throw new Error("lost response");
      return undefined;
    },
  });
  await assert.rejects(
    activateOpenaiAdsCampaign({
      apiKey: "secret", progress, expectedAccountId: "adacct_123", billingConfirmed: true,
      fetchImpl: uncertain.fetchImpl,
    }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "NETWORK_UNCERTAIN" &&
      error.mutationStarted && error.progress?.campaignId === "cmpn_123",
  );
  assert.deepEqual(
    uncertain.calls.filter((call) => call.init.method === "POST").map((call) => call.url.pathname),
    ["/v1/ads/ad_123/activate", "/v1/ad_groups/adgrp_123/activate", "/v1/campaigns/cmpn_123/activate"],
  );
});

test("le cycle de vie relit les ressources, met le parent en pause puis confirme l’état distant", async () => {
  const creation = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({
    apiKey: "secret", request: baseRequest, fetchImpl: creation.fetchImpl,
  });
  const activeApi = mockAdsApi({ resourceStatus: "active", reviewStatus: "approved" });
  const state = await readOpenaiAdsCampaignState({
    apiKey: "secret", progress, expectedAccountId: "adacct_123", fetchImpl: activeApi.fetchImpl,
  });
  assert.equal(state.campaignStatus, "active");
  assert.equal(state.reviewStatus, "approved");
  const paused = await setOpenaiAdsCampaignPaused({
    apiKey: "secret", progress, expectedAccountId: "adacct_123", paused: true,
    fetchImpl: activeApi.fetchImpl,
  });
  assert.equal(paused.stage, "paused");
  const mutations = activeApi.calls.filter((call) => call.init.method === "POST").map((call) => call.url.pathname);
  assert.deepEqual(mutations, ["/v1/campaigns/cmpn_123/pause"]);
  const campaignReads = activeApi.calls.filter((call) =>
    call.init.method === "GET" && call.url.pathname === "/v1/campaigns/cmpn_123");
  assert.equal(campaignReads.length, 3, "lecture initiale, préflight pause et confirmation après mutation");
});

test("un échec de confirmation après le POST pause reste marqué comme mutation distante", async () => {
  const creation = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({
    apiKey: "secret", request: baseRequest, fetchImpl: creation.fetchImpl,
  });
  let campaignReads = 0;
  const activeApi = mockAdsApi({
    resourceStatus: "active",
    reviewStatus: "approved",
    onCall: (call) => {
      if (call.url.pathname === "/v1/campaigns/cmpn_123" && call.init.method === "GET") {
        campaignReads += 1;
        if (campaignReads === 2) return json({ error: { code: "confirmation_unavailable" } }, 503);
      }
      return undefined;
    },
  });
  await assert.rejects(
    setOpenaiAdsCampaignPaused({
      apiKey: "secret", progress, expectedAccountId: "adacct_123", paused: true,
      fetchImpl: activeApi.fetchImpl,
    }),
    (error: unknown) => error instanceof OpenaiAdsPublishError &&
      error.code === "confirmation_unavailable" && error.httpStatus === 503 &&
      error.mutationStarted && error.progress?.campaignId === "cmpn_123",
  );
  assert.deepEqual(
    activeApi.calls.filter((call) => call.init.method === "POST").map((call) => call.url.pathname),
    ["/v1/campaigns/cmpn_123/pause"],
  );
});

test("la reprise lifecycle reste fail-closed si un appel non typé omet la confirmation de facturation", async () => {
  const creation = mockAdsApi();
  const progress = await createPausedOpenaiAdsCampaign({
    apiKey: "secret", request: baseRequest, fetchImpl: creation.fetchImpl,
  });
  const resumed = mockAdsApi({ reviewStatus: "approved" });
  await assert.rejects(
    setOpenaiAdsCampaignPaused({
      apiKey: "secret", progress, expectedAccountId: "adacct_123", paused: false,
      billingConfirmed: false, fetchImpl: resumed.fetchImpl,
    }),
    (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "BILLING_UNCONFIRMED",
  );
  assert.equal(resumed.calls.length, 0);
});
