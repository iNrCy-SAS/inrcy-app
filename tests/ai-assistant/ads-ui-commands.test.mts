import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseInrAssistantAdsPatch, inrAssistantAdsFieldsRequested, INR_ASSISTANT_ADS_FIELDS } from "../../lib/inrAssistantAdsUiCommands.ts";
import { isInrAssistantScreenCommandRequest, parseInrAssistantUiCommand } from "../../lib/inrAssistantUiCommands.ts";
import { parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";
import { prepareInrAssistantAdsFormPatch } from "../../lib/inrAssistantAdsFormPatch.ts";
import { persistVerifiedAdsDraft } from "../../lib/inrAssistantAdsDraftPersistence.ts";
import { loadInrAssistantAdsLibraryMedia } from "../../lib/inrAssistantAdsLibraryMedia.ts";
import { parseAdsCampaignInput, type AdsCampaignInput } from "../../lib/adsValidation.ts";
import { defaultMetaDeliverySettings } from "../../lib/adsMetaCampaignSettings.ts";
import { defaultGoogleDeliverySettings } from "../../lib/adsGoogleCampaignSettings.ts";
import { defaultLinkedInDeliverySettings } from "../../lib/adsLinkedInCampaignSettings.ts";
import { defaultPinterestDeliverySettings } from "../../lib/adsPinterestCampaignSettings.ts";
import { defaultOpenaiDeliverySettings } from "../../lib/adsOpenaiCampaignSettings.ts";
import { defaultPreparedDeliverySettings } from "../../lib/adsPreparedCampaignSettings.ts";
import { defaultAdsChannelWizardSettings } from "../../lib/adsChannelWizardSettings.ts";

const ID = "11111111-1111-4111-8111-111111111111";
function draft(provider: AdsCampaignInput["provider"] = "meta"): AdsCampaignInput {
  const parsed = parseAdsCampaignInput({ provider, accountCurrency: "EUR", name: "Original", dailyBudgetEuros: 20, endDate: "2026-12-30", primaryText: "Original offer", targetLocations: ["Lille"],
    ...(provider === "meta" ? { metaDeliverySettings: defaultMetaDeliverySettings() } : {}), ...(provider === "google" ? { googleDeliverySettings: defaultGoogleDeliverySettings() } : {}),
    ...(provider === "linkedin" ? { linkedinDeliverySettings: defaultLinkedInDeliverySettings() } : {}), ...(provider === "pinterest" ? { pinterestDeliverySettings: defaultPinterestDeliverySettings() } : {}),
    ...(provider === "openai" ? { openaiDeliverySettings: defaultOpenaiDeliverySettings() } : {}), ...(["x", "tiktok"].includes(provider) ? { preparedDeliverySettings: defaultPreparedDeliverySettings() } : {}),
    ...(["x", "tiktok", "pinterest", "linkedin"].includes(provider) ? { channelSettings: defaultAdsChannelWizardSettings(provider as "x") } : {}),
  }, { purpose: "draft" });
  assert.ok(parsed.draft, parsed.error ?? "draft exists"); return parsed.draft;
}
const changes = (values: Record<string, unknown>) => parseInrAssistantAdsPatch({ adsChanges: Object.entries(values).map(([field, value]) => ({ field, valueJson: JSON.stringify(value) })) });

test("bounded Ads grammar refuses consent, arbitrary resource IDs, extra fields, duplicates and mixed destructive transitions", () => {
  for (const key of ["confirmedSpend", "notEuPoliticalConfirmed", "adAccountId", "provider", "__proto__", "imageUrl", "channelDraft", "metaGeoTargets"]) assert.equal(changes({ [key]: true }), null, key);
  assert.equal(parseInrAssistantAdsPatch({ channel: "google", name: "Overwrite" }), null);
  assert.equal(parseInrAssistantAdsPatch({ mediaId: ID, primaryText: "Other" }), null);
  assert.equal(changes({ "channelSettings.format": "video", dailyBudgetEuros: 50 }), null);
  assert.equal(parseInrAssistantAdsPatch({ adsChanges: [{ field: "offer", valueJson: '"one"' }, { field: "offer", valueJson: '"two"' }] }), null);
  assert.equal(parseInrAssistantAdsPatch({ adsChanges: [{ field: "offer", valueJson: '{"unexpected":true}' }] }), null);
});

test("every exposed nested Ads field is a real native form setting, never a synthetic property", () => {
  const all = ["meta", "google", "linkedin", "pinterest", "openai", "x", "tiktok"].map(channel => draft(channel as AdsCampaignInput["provider"]));
  for (const field of INR_ASSISTANT_ADS_FIELDS.filter(value => value.includes("."))) assert.ok(all.some(value => field.split(".").reduce<unknown>((row, key) => row && typeof row === "object" ? (row as Record<string, unknown>)[key] : undefined, value) !== undefined), field);
});

test("native budget/date/targeting adapters preserve all unrequested sibling fields and originals", () => {
  const source = draft(), before = structuredClone(source);
  const input = changes({ dailyBudgetEuros: 35, "metaDeliverySettings.budget.startAt": "2026-12-01T09:00:00.000Z", "metaDeliverySettings.audience.ageMin": 25, targetLocations: ["Paris"] }); assert.ok(input);
  const result = prepareInrAssistantAdsFormPatch(source, input); assert.ok(result.patch, result.error ?? "patch");
  assert.equal(result.patch.dailyBudgetEuros, 35); assert.equal(result.patch.metaDeliverySettings?.audience.ageMin, 25);
  assert.equal(result.patch.metaDeliverySettings?.bidding.strategy, before.metaDeliverySettings?.bidding.strategy);
  assert.deepEqual(result.patch.targetLocations, ["Paris"]); assert.deepEqual(source, before);
  assert.ok(!Object.hasOwn(result.patch, "primaryText")); assert.ok(!Object.hasOwn(result.patch, "notEuPoliticalConfirmed"));
});

test("invalid native values and wrong-channel fields are rejected without coercing them into defaults", () => {
  for (const fields of [{ dailyBudgetEuros: "30" }, { dailyBudgetEuros: 4 }, { googleSearchPartners: "false" }, { campaignType: "invented" }, { "metaDeliverySettings.audience.ageMin": 12 }, { "googleDeliverySettings.startDate": "2026-12-01" }]) {
    const input = changes(fields); assert.ok(input); assert.equal(prepareInrAssistantAdsFormPatch(draft(), input).patch, null, JSON.stringify(fields));
  }
});

test("a hidden legacy budget/date/button cannot be acknowledged instead of the effective native setting", () => {
  const source = draft();
  source.metaDeliverySettings!.budget = { type: "total", totalEuros: 300, startAt: null, endAt: "2026-12-20T12:00:00.000Z" };
  for (const values of [{ dailyBudgetEuros: 50 }, { endDate: "2026-12-25" }, { callToAction: "Acheter" }]) {
    const input = changes(values); assert.ok(input); assert.equal(prepareInrAssistantAdsFormPatch(source, input).patch, null);
  }
  const daily = changes({ dailyBudgetEuros: 50, "metaDeliverySettings.budget.type": "daily", "metaDeliverySettings.budget.totalEuros": null }); assert.ok(daily);
  assert.equal(prepareInrAssistantAdsFormPatch(source, daily).patch?.dailyBudgetEuros, 50);
  const precise = changes({ "metaDeliverySettings.budget.endAt": "2026-12-25T12:00:00.000Z" }); assert.ok(precise);
  assert.equal(prepareInrAssistantAdsFormPatch(source, precise).patch?.metaDeliverySettings?.budget.endAt, "2026-12-25T12:00:00.000Z");
  const button = changes({ "metaDeliverySettings.callToAction": "LEARN_MORE" }); assert.ok(button);
  assert.equal(prepareInrAssistantAdsFormPatch(source, button).patch?.callToAction, "En savoir plus");
});

test("save and draft changes require unquoted current instructions and explicit requested amounts", () => {
  const text = "Enregistre le brouillon de cette campagne publicitaire";
  assert.equal(isInrAssistantScreenCommandRequest(text, "save_ads_draft"), true);
  for (const request of [`Lis : « ${text} »`, `\`${text}\``, `\`\`\`\n${text}\n`, `Ne ${text.toLowerCase()} pas`, `Si tout va bien, ${text}`, `${text} demain`, `${text} après ma confirmation`, "Enregistre pas cette campagne", `Comment ${text.toLowerCase()} ?`]) assert.equal(isInrAssistantScreenCommandRequest(request, "save_ads_draft"), false, request);
  const patch = changes({ dailyBudgetEuros: 50 }); assert.ok(patch);
  assert.equal(inrAssistantAdsFieldsRequested("Mets le budget publicitaire à 50 €", patch), true);
  assert.equal(inrAssistantAdsFieldsRequested("Mets le budget publicitaire à 20 €", patch), false);
  assert.equal(inrAssistantAdsFieldsRequested('Renomme la campagne « budget 50 € »', patch), false);
  const screen = { pathname: "/dashboard/ads", selection: { kind: "campaign", id: "editor" }, revision: "revision_1", availableCommands: ["save_ads_draft"] };
  assert.ok(parseInrAssistantClientContext({ screen })?.screen?.availableCommands?.includes("save_ads_draft"));
  assert.equal(parseInrAssistantClientContext({ screen: { ...screen, pathname: "/dashboard/mails" } })?.screen?.availableCommands, undefined);
  assert.ok(parseInrAssistantUiCommand({ command: "save_ads_draft", ...screen }));
});

test("native draft save proves exact readback without publishing or introducing a provider call", async () => {
  const source = draft(), calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ campaign: init?.method === "POST" ? { id: ID, status: "draft" } : { id: ID, status: "draft", provider: source.provider, draft: source } }); };
  const saved = await persistVerifiedAdsDraft({ draft: source, savedId: null, idempotencyKey: "fixture-idempotency", isCurrent: () => true, fetch: fetcher });
  assert.equal(saved.id, ID); assert.equal(calls.length, 2); assert.deepEqual(calls.map(item => item.url), ["/api/ads/campaigns", `/api/ads/campaigns/${ID}`]);
  assert.equal(new Headers(calls[0].init?.headers).get("Idempotency-Key"), "fixture-idempotency"); assert.ok(calls.every(item => item.init?.signal instanceof AbortSignal));
  assert.equal((JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>).confirmedSpend, undefined);
});

test("native draft save refuses changed content, non-draft, wrong ID and late account response without retry", async () => {
  for (const mode of ["changed", "published", "wrong-id", "account", "lost"]) {
    const source = draft(); let current = true, calls = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      calls++;
      if (mode === "lost") throw new Error("uncertain write");
      if (mode === "account") current = false;
      return Response.json({ campaign: init?.method === "POST" ? { id: ID, status: "draft" } : { id: mode === "wrong-id" ? "other" : ID, status: mode === "published" ? "published" : "draft", provider: source.provider, draft: { ...source, ...(mode === "changed" ? { name: "Someone else" } : {}) } } });
    };
    await assert.rejects(persistVerifiedAdsDraft({ draft: source, savedId: null, idempotencyKey: "fixture", isCurrent: () => current, fetch: fetcher }));
    assert.equal(calls, ["account", "lost"].includes(mode) ? 1 : 2, mode);
  }
});

test("uncertain native draft writes time out once without automatic replay", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => { calls++; return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("bounded abort")), { once: true })); };
  const pending = assert.rejects(persistVerifiedAdsDraft({ draft: draft(), savedId: null, idempotencyKey: "fixture", isCurrent: () => true, fetch: fetcher }), /bounded abort/);
  context.mock.timers.tick(15_000); await pending; assert.equal(calls, 1);
});

test("Ads media lookup accepts the exact owned native reference and rejects invented URLs and stale target", async () => {
  for (const mode of ["ok", "foreign", "url", "late", "audio"]) {
    let current = true;
    const fetcher: typeof fetch = async () => { if (mode === "late") current = false; return Response.json({ items: [{ id: mode === "foreign" ? "other" : ID, media_type: mode === "audio" ? "audio" : "image", size_bytes: 1000, signed_url: mode === "url" ? "https://foreign.invalid/image.jpg" : `/api/media-library/items/${ID}/content?token=fixture` }] }); };
    assert.equal(Boolean(await loadInrAssistantAdsLibraryMedia(ID, () => current, fetcher)), mode === "ok", mode);
  }
});

test("Ads owner retains native edit/media/saved proof and does not wire launch or consent to assistant", () => {
  const source = readFileSync("app/dashboard/ads/AdsClient.tsx", "utf8");
  const start = source.indexOf("  useInrAssistantAdsCommands({"), end = source.indexOf("\n  function confirmReviewedDeclaration", start); assert.ok(start > 0 && end > start);
  const bridge = source.slice(start, end);
  assert.match(bridge, /updateDraft\(patch\)/); assert.match(bridge, /updateNativeSettings\(channelSettings\)/); assert.match(bridge, /applyCampaignMedia\(item/); assert.match(bridge, /return saveDraft\(\{ isCurrent \}\)/);
  assert.doesNotMatch(bridge, /openLaunchDialog\(|createPreparedPausedCampaign\(|setConfirmedSpend\(true\)|confirmReviewedDeclaration\(/);
});
