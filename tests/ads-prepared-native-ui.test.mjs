import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as client from "../lib/adsPreparedNativeClient.ts";
import * as xResources from "../lib/adsXResources.ts";
import * as ttResources from "../lib/adsTikTokResources.ts";
import * as ttLocation from "../lib/adsTikTokLocationSelection.ts";

const accountA = "ab12", accountB = "cd34", ttAccount = "12345678901";
const mediaA = "bf523971-5884-466d-9cc4-09cdf4a08d53", mediaB = "73888634-753e-4092-bb2b-73b63a251dd5";
const url = (id) => `/api/media-library/items/${id}/content`;
const geoA = { id: "geo1", name: "Lille, France", countryCode: "FR", locationType: "CITIES" };
const geoB = { id: "geo2", name: "Arras, France", countryCode: "FR", locationType: "CITIES" };
const ttGeo = { id: "123", name: "Lille", countryCode: "FR", parentId: "12", level: "CITY", areaType: "ADMIN", path: ["Hauts-de-France", "France"] };
function xNative(accountId = accountA) { return { schemaVersion: 1, accountId, context: { objective: "ENGAGEMENTS", format: "text", targetingMode: "broad", placements: "ALL_ON_TWITTER" }, fundingInstrumentId: null, promotableUserId: null, postId: null, geoTargets: [] }; }
function xResource(accountId = accountA, funds = ["fund1"], users = ["user1"]) { return { selectedAccountId: accountId, account: { id: accountId, name: "Compte", currency: "EUR", permissions: ["ACCOUNT_ADMIN"], timeZone: "Europe/Paris", approvalStatus: "ACCEPTED", deleted: false, canManageCampaigns: true, billingReady: true, eligibleToAssociate: true }, fundingInstruments: funds.map((id) => ({ id, currency: "EUR", ableToFund: true, deleted: false, cancelled: false })), promotableUsers: users.map((id) => ({ id, userId: "1234567890123456789", type: "FULL" })), posts: [], capabilities: { standardAccess: "unverified", tokenRegeneratedAfterApproval: "unverified", nativeWriteAccess: "unverified" }, publicationEnabled: false, verifiedAt: "2026-10-08T12:00:00Z" }; }
function ttResource(identities = [{ id: "id1", type: "TT_USER", displayName: "Entreprise" }]) { return { selectedAccountId: ttAccount, account: { id: ttAccount, name: "Compte", currency: "EUR", status: "STATUS_ENABLE", timezone: "Europe/Paris" }, identities, identityRead: { status: "verified" }, readiness: { advertiserRead: true, campaignWrite: "unverified", publicationReady: false, blockers: [] }, publicationEnabled: false, verifiedAt: "2026-10-08T12:00:00Z" }; }
function xGeoResponse(accountId = accountA, query = "Lille", target = geoA, options = [target]) { return { selectedAccountId: accountId, resolutions: [{ query, options, autoSelectedTarget: target }], options, complete: true, publicationEnabled: false }; }
function ttGeoResponse(accountId = ttAccount, query = "Lille", target = ttGeo, candidates = [target], status = "resolved") { return { selectedAccountId: accountId, context: ttResources.TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, resolutions: [{ query, status, target, candidates }], publicationEnabled: false }; }
function descendants(value) { if (Array.isArray(value)) return value.flatMap(descendants); if (!value || typeof value !== "object" || !value.props) return []; return [value, ...descendants(value.props.children)]; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(component, initial) {
  const slots = [], effects = new Map(), timers = new Map(), requests = [], changes = [], readiness = [], resources = [], frames = [], uploads = [], resolved = [];
  let index = 0, pending = [], dirty = false, props, tree, timerId = 0;
  const patchDraft = (patch) => { changes.push(patch); props = { ...props, draft: { ...props.draft, ...patch } }; dirty = true; };
  props = { onChange: patchDraft, onReadiness: (value) => readiness.push(value), onXResources: (value) => resources.push(value), ...initial };
  const react = {
    useId: () => { const at = index++; return slots[at] ?? (slots[at] = `test-${at}`); },
    useRef: (value) => { const at = index++; return slots[at] ?? (slots[at] = { current: value }); },
    useState: (value) => { const at = index++; if (!(at in slots)) slots[at] = typeof value === "function" ? value() : value; return [slots[at], (next) => { const actual = typeof next === "function" ? next(slots[at]) : next; if (!Object.is(actual, slots[at])) { slots[at] = actual; dirty = true; } }]; },
    useEffect: (effect, deps) => { const at = index++, old = effects.get(at); if (!old || !deps || !old.deps || deps.some((value, position) => !Object.is(value, old.deps[position]))) pending.push(() => { old?.cleanup?.(); effects.set(at, { deps, cleanup: effect() }); }); },
  };
  const modules = new Map([
    ["react", react], ["react/jsx-runtime", { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: Symbol("fragment") }],
    ["@/lib/adsPreparedNativeClient", client], ["@/lib/adsXResources", xResources], ["@/lib/adsTikTokResources", ttResources], ["@/lib/adsTikTokLocationSelection", ttLocation],
    ["@/lib/adsTikTokThumbnailClient", { prepareOwnedTikTokThumbnail: (url, signal) => new Promise((resolve, reject) => frames.push({ url, signal, resolve, reject })) }],
    ["@/lib/mediaLibraryUploadClient", { uploadFileToMediaLibrary: async (file, metadata) => { uploads.push({ file, metadata }); return { ok: true, id: mediaB }; } }],
    ["./linkedin-campaign.module.css", { default: new Proxy({}, { get: (_, key) => String(key) }) }],
  ]);
  const runtimeModule = { exports: {} }, code = ts.transpileModule(readFileSync(new URL(`../app/dashboard/ads/${component}.tsx`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("module", "exports", "require", "fetch", "setTimeout", "clearTimeout", code)(runtimeModule, runtimeModule.exports, (name) => { assert.ok(modules.has(name), name); return modules.get(name); }, (path, init = {}) => new Promise((resolve) => requests.push({ path, init, resolve })), (action) => { const id = ++timerId; timers.set(id, action); return id; }, (id) => timers.delete(id));
  function render(updates = {}) { props = { ...props, ...updates }; let cycles = 0; do { dirty = false; index = 0; pending = []; tree = runtimeModule.exports.default(props); const run = pending; pending = []; run.forEach((effect) => effect()); if (++cycles > 20) assert.fail("Native component did not settle: effect loop"); } while (dirty); return tree; }
  async function finish(at, body, ok = true) { requests[at].resolve({ ok, json: async () => body }); await tick(); render(); }
  async function finishFrame(at) { frames[at].resolve({ file: { name: "thumb.jpg" }, width: 1080, height: 1920, videoMediaId: client.ownedPreparedVideoId(frames[at].url) }); await tick(); render(); }
  function runTimers() { const run = [...timers.values()]; timers.clear(); run.forEach((action) => action()); }
  return { render, finish, finishFrame, runTimers, requests, changes, readiness, resources, frames, uploads, resolved, elements: (type) => descendants(tree).filter((item) => item.type === type), get props() { return props; } };
}
const xDraft = (accountId = accountA) => ({ provider: "x", adAccountId: accountId, targetLocations: ["Lille"], primaryText: "Votre communication simplifiée", xNativeSelections: xNative(accountId) });
const xProps = () => ({ draft: xDraft(), active: true, connected: true, selectedAccountId: accountA, tikTokResources: null, mode: "campaign" });
function ttProps(video = "") { const resource = ttResource(); return { draft: { provider: "tiktok", adAccountId: ttAccount, targetLocations: [], creativeType: "video", creativeUrl: video, tiktokNativeSelections: client.automaticTikTokNativeSelections(resource) }, active: true, connected: true, selectedAccountId: ttAccount, tikTokResources: resource, mode: "final" }; }

test("Actual native controls discard old account reads and settle unique selections without a request loop", async () => {
  const h = harness("PreparedAdsNativeControls", xProps()); h.render(); assert.equal(h.requests.length, 2);
  h.render({ selectedAccountId: accountB, draft: xDraft(accountB) }); assert.ok(h.requests.slice(0, 2).every((row) => row.init.signal.aborted));
  await h.finish(2, xResource(accountB)); await h.finish(3, xGeoResponse(accountB)); await h.finish(0, xResource()); await h.finish(1, xGeoResponse());
  assert.equal(h.props.draft.xNativeSelections.accountId, accountB); assert.equal(h.props.draft.xNativeSelections.fundingInstrumentId, "fund1"); assert.equal(h.props.draft.xNativeSelections.promotableUserId, "user1"); assert.equal(h.props.draft.xNativeSelections.postId, null);
  assert.ok(h.changes.every((patch) => !patch.xNativeSelections || patch.xNativeSelections.accountId === accountB));
  const count = h.requests.length; for (let at = 0; at < 4; at++) h.render(); assert.equal(h.requests.length, count);
});
test("Actual final native preflight is read-only and ignores a late response after draft edits", async () => {
  const h = harness("PreparedAdsNativeControls", { ...xProps(), mode: "final" }); h.render(); await h.finish(0, xResource()); h.runTimers();
  const first = h.requests.findIndex((request) => request.path === "/api/ads/x/preflight"); assert.ok(first >= 0); assert.equal(h.requests[first].init.method, "POST"); assert.deepEqual(JSON.parse(h.requests[first].init.body), { draft: h.props.draft });
  h.render({ draft: { ...h.props.draft, primaryText: "Nouvelle version relue" } }); assert.equal(h.requests[first].init.signal.aborted, true); h.runTimers();
  const second = h.requests.findLastIndex((request) => request.path === "/api/ads/x/preflight");
  const check = { ready: false, preparationReady: true, publicationEnabled: false, pausedCreationEnabled: false, targetStatus: "PAUSED", selectedAccountId: accountA, verifiedLocationCount: 1, resourcesKey: "fresh", consentKey: "proof", blockers: ["paused_creation_disabled"] };
  await h.finish(second, check); await h.finish(first, { ...check, ready: true, pausedCreationEnabled: true, consentKey: "obsolete" });
  assert.equal(h.readiness.at(-1).draftKey, JSON.stringify(h.props.draft)); assert.equal(h.readiness.at(-1).check.consentKey, "proof"); assert.ok(h.requests.every((row) => !row.path.endsWith("/publish") && !row.path.endsWith("/campaigns")));
});
test("Actual TikTok identity dropdown distinguishes same ID under different authorization types", () => {
  const props = ttProps(), second = { id: "id1", type: "BC_AUTH_TT", displayName: "Entreprise autorisée", authorizedBusinessCenterId: "bc123" };
  props.tikTokResources = ttResource([props.tikTokResources.identities[0], second]); props.draft.tiktokNativeSelections = client.automaticTikTokNativeSelections(props.tikTokResources);
  const h = harness("PreparedAdsNativeControls", props); h.render(); const select = h.elements("select")[0], options = descendants(select).filter((item) => item.type === "option" && item.props.value);
  assert.equal(options.length, 2); assert.notEqual(options[0].props.value, options[1].props.value);
  select.props.onChange({ target: { value: options[1].props.value } }); h.render(); assert.deepEqual(h.props.draft.tiktokNativeSelections.identity, { id: second.id, type: second.type, authorizedBusinessCenterId: second.authorizedBusinessCenterId });
});
test("Actual TikTok radios require an explicit AIGC declaration and remain mutually exclusive", () => {
  const h = harness("PreparedAdsNativeControls", ttProps()); h.render(); let radios = h.elements("input").filter((item) => item.props.type === "radio");
  assert.equal(radios.length, 2); assert.equal(radios.filter((item) => item.props.checked).length, 0); assert.equal(radios[0].props.name, radios[1].props.name);
  radios[0].props.onChange(); h.render(); assert.equal(h.props.draft.tiktokNativeSelections.isAiGenerated, true); radios = h.elements("input").filter((item) => item.props.type === "radio"); assert.equal(radios.filter((item) => item.props.checked).length, 1);
  radios[1].props.onChange(); h.render(); assert.equal(h.props.draft.tiktokNativeSelections.isAiGenerated, false);
});
test("Actual thumbnail effect ignores a stale video frame and uploads only the current owned video", async () => {
  const h = harness("PreparedAdsNativeControls", ttProps(url(mediaA))); h.render(); assert.equal(h.frames.length, 1);
  h.render({ draft: { ...h.props.draft, creativeUrl: url(mediaB), tiktokNativeSelections: { ...h.props.draft.tiktokNativeSelections, thumbnailMediaId: null } } }); assert.equal(h.frames[0].signal.aborted, true); assert.equal(h.frames.length, 2);
  await h.finishFrame(0); assert.equal(h.uploads.length, 0); await h.finishFrame(1); assert.equal(h.uploads.length, 1); assert.equal(h.uploads[0].metadata.metadata.source_video_media_id, mediaB); assert.equal(h.props.draft.tiktokNativeSelections.thumbnailMediaId, mediaB);
  h.render(); assert.equal(h.frames.length, 2); assert.equal(h.uploads.length, 1);
});
test("Actual X location picker ignores old account/query responses and retains one exact native choice", async () => {
  let changed = []; const props = { accountId: accountA, locations: ["Lille"], selections: xNative(), active: true, onChange: (locations, selections) => changed.push({ locations, selections }) };
  const h = harness("XAdsLocationPicker", props); h.render(); h.render({ accountId: accountB, locations: ["Arras"], selections: xNative(accountB) }); assert.equal(h.requests[0].init.signal.aborted, true);
  await h.finish(1, xGeoResponse(accountB, "Arras", geoB)); await h.finish(0, xGeoResponse()); const select = h.elements("select")[0]; assert.equal(select.props.value, geoB.id);
  select.props.onChange({ target: { value: geoB.id } }); assert.deepEqual(changed, [{ locations: [geoB.name], selections: { ...xNative(accountB), geoTargets: [geoB] } }]);
});
test("Actual TikTok location picker discards stale account reads and never selects ambiguous candidates", async () => {
  const results = []; const h = harness("TikTokAdsLocationPicker", { accountId: ttAccount, locations: ["Lille"], active: true, onChange() {}, onResolvedTargets: (targets) => results.push(targets) }); h.render();
  h.render({ locations: ["Lille, Hauts-de-France, France"] }); assert.equal(h.requests[0].init.signal.aborted, true);
  await h.finish(0, ttGeoResponse()); assert.equal(results.length, 0);
  await h.finish(1, ttGeoResponse(ttAccount, "Lille, Hauts-de-France, France", null, [ttGeo], "ambiguous")); assert.equal(results.length, 0); assert.equal(h.elements("select")[0].props.value, "");
  const count = h.requests.length; h.render(); assert.equal(h.requests.length, count);
});
function thumbnailRuntime() {
  const listeners = new Map(), timeouts = new Map(); let nextTimer = 0, paused = 0, cleared = 0, loaded = 0, draw = 0, blobCallback;
  const video = { videoWidth: 1080, videoHeight: 1920, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); }, load: () => loaded++, pause: () => paused++, removeAttribute: (name) => { assert.equal(name, "src"); cleared++; } };
  const canvas = { getContext: () => ({ drawImage: () => draw++ }), toBlob: (callback) => { blobCallback = callback; } };
  const runtimeModule = { exports: {} }, code = ts.transpileModule(readFileSync(new URL("../lib/adsTikTokThumbnailClient.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", "require", "document", "setTimeout", "clearTimeout", code)(runtimeModule, runtimeModule.exports, (name) => { assert.equal(name, "./adsPreparedNativeClient.ts"); return client; }, { createElement: (name) => name === "video" ? video : canvas }, (action) => { const id = ++nextTimer; timeouts.set(id, action); return id; }, (id) => timeouts.delete(id));
  return { run: runtimeModule.exports.prepareOwnedTikTokThumbnail, video, fire: (name) => listeners.get(name)?.(), finishBlob: () => blobCallback(new Blob(["simulated-jpeg-frame"], { type: "image/jpeg" })), state: () => ({ paused, cleared, loaded, draw, listeners: listeners.size, timers: timeouts.size }) };
}
test("Actual thumbnail client rejects remote/signed media before decoding and cleans aborted video listeners", async () => {
  for (const invalid of ["https://assets.example/video.mp4", `${url(mediaA)}?token=secret`]) { const t = thumbnailRuntime(); await assert.rejects(t.run(invalid, new AbortController().signal), /médiathèque/); assert.equal(t.state().loaded, 0); }
  const t = thumbnailRuntime(), controller = new AbortController(), result = t.run(url(mediaA), controller.signal); controller.abort(); await assert.rejects(result, (error) => error.name === "AbortError");
  assert.deepEqual(t.state(), { paused: 1, cleared: 1, loaded: 2, draw: 0, listeners: 0, timers: 0 });
});
test("Actual thumbnail client preserves source ownership and dimensions and cleans a successful decoded frame", async () => {
  const t = thumbnailRuntime(), result = t.run(url(mediaA), new AbortController().signal); t.fire("loadeddata"); await tick(); t.finishBlob(); const frame = await result;
  assert.equal(frame.videoMediaId, mediaA); assert.equal(frame.width, 1080); assert.equal(frame.height, 1920); assert.equal(frame.file.type, "image/jpeg"); assert.equal(frame.file.name, `tiktok-${mediaA}.jpg`);
  assert.deepEqual(t.state(), { paused: 1, cleared: 1, loaded: 2, draw: 1, listeners: 0, timers: 0 });
});
test("Actual thumbnail client discards a frame aborted during encoding and refuses invalid dimensions", async () => {
  const t = thumbnailRuntime(), controller = new AbortController(), result = t.run(url(mediaA), controller.signal); t.fire("loadeddata"); await tick(); controller.abort(); t.finishBlob(); await assert.rejects(result, (error) => error.name === "AbortError"); assert.equal(t.state().cleared, 1);
  const invalid = thumbnailRuntime(); invalid.video.videoWidth = 0; const failure = invalid.run(url(mediaA), new AbortController().signal); invalid.fire("loadeddata"); await assert.rejects(failure, /format/); assert.equal(invalid.state().draw, 0); assert.equal(invalid.state().cleared, 1);
});
