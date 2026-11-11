import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { publicationEditSourceVersion } from "../../lib/inrsend/publicationEditVersion.ts";

type Row = Record<string, unknown>;
const { guardPublishedPublicationEdit } = runtimeModules()<typeof import("../../lib/inrsend/publicationEditGuard.ts")>("lib/inrsend/publicationEditGuard.ts");
const VERSION = "a".repeat(64);
function harness() {
  let version = VERSION, scope = true, effect = 0, seals = 0, afterAcquire = () => {}, mode = "success", failSeal = false;
  const locks = new Map<string, { id: string; result: Row | null }>();
  const run = (body: Row = { title: "Nouveau", expectedState: VERSION, operationKey: "native-edit-key" }) => guardPublishedPublicationEdit({ body, currentScope: async () => scope, readVersion: async () => version,
    acquire: async key => { if (locks.has(key)) return { state: locks.get(key)!.result ? "completed" : "running", lock: locks.get(key)! }; const lock = { id: key, result: null }; locks.set(key, lock); afterAcquire(); return { state: "acquired", lock }; },
    seal: async (id, result) => { if (failSeal) throw new Error("DB unavailable"); seals++; locks.set(id, { id, result }); },
    mutate: async () => { effect++; if (mode === "throw-after-commit") throw new Error("lost response after provider accepted"); return mode === "failure" ? Response.json({ ok: false, error: "provider private" }, { status: 500 }) : Response.json({ ok: true, publication_id: "publication", channel: "facebook", payload: { private: "not stored in receipt" } }); },
  });
  return { run, locks, get effects() { return effect; }, get seals() { return seals; }, changeDuringLock() { afterAcquire = () => { version = "b".repeat(64); }; }, scopeAfterLock() { afterAcquire = () => { scope = false; }; }, accountChanged() { scope = false; }, uncertain() { mode = "throw-after-commit"; }, failed() { mode = "failure"; }, sealFailed() { failSeal = true; }, expire() { /* Completed receipts have no recoverable lease. */ } };
}

test("native published edits seal durable no-retry receipts before provider work and replay only the same verified mutation", async () => {
  const h = harness(); assert.equal((await h.run()).ok, true); assert.equal(h.effects, 1); assert.equal(h.seals, 2);
  const repeated = await h.run(); assert.equal(repeated.ok, true); assert.equal(h.effects, 1); assert.equal((await repeated.json()).cachedReceipt, true);
  assert.doesNotMatch(JSON.stringify([...h.locks.values()]), /private|payload/);
  assert.equal((await h.run({ title: "Différent", expectedState: VERSION, operationKey: "another-key" })).status, 409); assert.equal(h.effects, 1);
  h.accountChanged(); assert.equal((await h.run()).status, 409); assert.equal(h.effects, 1, "cached receipt still requires the same active scope");
});

test("native published edits refuse a missing source version, a source change between read and lock, or an unsealed attempt", async () => {
  const missing = harness(); assert.equal((await missing.run({ title: "Nouveau" })).status, 428); assert.equal(missing.effects, 0); assert.equal(missing.locks.size, 0);
  for (const mutate of [(h: ReturnType<typeof harness>) => h.changeDuringLock(), (h: ReturnType<typeof harness>) => h.scopeAfterLock(), (h: ReturnType<typeof harness>) => h.sealFailed()]) { const h = harness(); mutate(h); assert.equal((await h.run()).ok, false); assert.equal(h.effects, 0); }
});

test("native published edit uncertainty after external commit remains non-retryable across expiration and new requests", async () => {
  for (const mutate of [(h: ReturnType<typeof harness>) => h.uncertain(), (h: ReturnType<typeof harness>) => h.failed()]) {
    const h = harness(); mutate(h); assert.equal((await h.run()).ok, false); assert.equal(h.effects, 1);
    h.expire(); const response = await h.run(); assert.equal(response.ok, false); assert.equal(h.effects, 1); assert.match(String((await response.json()).code), /publication_edit/);
  }
});

test("published edit source versions share exact canonical event bytes across browser and server scopes", async () => {
  const payload = { publication_id: "publication", postByChannel: { facebook: { content: "A" }, instagram: { content: "B" } } };
  const version = await publicationEditSourceVersion("account", "publication", "facebook", payload);
  assert.equal(version, await publicationEditSourceVersion("account", "publication", "facebook", { postByChannel: payload.postByChannel, publication_id: "publication" }));
  for (const [account, channel, value] of [["other", "facebook", payload], ["account", "instagram", payload], ["account", "facebook", { ...payload, changed: true }]] as const) assert.notEqual(version, await publicationEditSourceVersion(account, "publication", channel, value));
});

function actualFunction(file: string, name: string, deps: Row) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found: ts.FunctionDeclaration | undefined; const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(found);
  const compiled = ts.transpileModule(`(${found.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps);
}

test("the actual native published event write uses exact payload CAS and cannot overwrite a concurrent channel result", async () => {
  const account = "00000000-0000-4000-8000-000000000001", eventId = "00000000-0000-4000-8000-000000000002";
  const original = { publication_id: "publication", facebook: "old", instagram: "preserved" };
  const next = { ...original, facebook: "new" };
  let writes = 0;
  const { PublicationEditSourceChangedError } = runtimeModules()<typeof import("../../lib/inrsend/publicationEditGuard.ts")>("lib/inrsend/publicationEditGuard.ts");
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create table public.app_events(id uuid primary key,user_id uuid,module text,type text,payload jsonb);");
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261111195022_inrsend_event_payload_compare_and_swap.sql", import.meta.url), "utf8"));
    await db.query("insert into public.app_events values($1,$2,'booster','publish',$3)", [eventId,account,original]);
    const supabaseAdmin = {
      from() { assert.fail("The guarded snapshot must use RPC body parameters rather than a JSON URL filter"); },
      async rpc(name: string, params: Row) {
        assert.equal(name, "inrsend_compare_and_swap_event_payload");
        assert.equal(params.p_user_id, account);
        assert.equal(params.p_event_id, eventId);
        assert.equal(params.p_publication_id, "publication");
        const result = await db.query<{saved: boolean}>("select public.inrsend_compare_and_swap_event_payload($1,$2,$3,$4,$5) as saved", [params.p_user_id,params.p_event_id,params.p_publication_id,params.p_expected_payload,params.p_next_payload]);
        if (result.rows[0].saved) writes++;
        return {data: result.rows[0].saved, error: null};
      },
    };
    const native = actualFunction("lib/inrsend/publicationChannelActions.ts", "persistEventPayload", { supabaseAdmin, PublicationEditSourceChangedError }) as (account: string, publication: string, next: Row, signal: undefined, expected: { id: string; payload: Row }) => Promise<void>;
    await native(account, "publication", next, undefined, {id: eventId, payload: original});
    assert.equal(writes, 1);
    const saved = await db.query<{payload: Row}>("select payload from public.app_events where id=$1", [eventId]);
    assert.deepEqual(saved.rows[0].payload, next);
    const reviewedSnapshot = structuredClone(saved.rows[0].payload);
    const concurrent = {...reviewedSnapshot, instagram: "changed concurrently"};
    await db.query("update public.app_events set payload=$1 where id=$2", [concurrent,eventId]);
    await assert.rejects(() => native(account, "publication", {...next,facebook: "another change"}, undefined, {id: eventId,payload: reviewedSnapshot}), PublicationEditSourceChangedError);
    assert.equal(writes, 1);
    const retained = await db.query<{payload: Row}>("select payload from public.app_events where id=$1", [eventId]);
    assert.deepEqual(retained.rows[0].payload, concurrent);
  } finally { await db.close(); }
});

test("the actual native media edit preserves another channel and its shared original fallback", () => {
  const asRecord = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  const builder = actualFunction("lib/inrsend/publicationChannelActions.ts", "buildUpdatedPayload", { asRecord, cloneRecord: structuredClone, normalizeSiteWebChannelMap: asRecord, canonicalSiteWebChannel: (value: string) => value,
    buildVideoSettingsByChannel: () => ({}), normalizeChannelVideoSettings: () => ({ format: "original", adaptationMode: "safe_frame" }), normalizeVideoAttachment: (value: unknown) => value, getChannelPost: () => ({}),
  }) as (input: Row) => Row;
  const instagram = { content: "Instagram", images: ["original-instagram"] }, original = { channels: ["facebook", "instagram"], post: { content: "Shared caption" }, postByChannel: { facebook: { content: "Facebook" }, instagram }, mediaType: "images", results: { facebook: { external_id: "old-facebook" }, instagram: { external_id: "original-instagram", status: "delivered" } } };
  const updated = builder({ eventPayload: original, publication: {}, channel: "facebook", nextPost: { title: "Nouveau", content: "Facebook corrigé" }, externalId: "new-facebook", mediaType: "video", video: { storagePath: "owned-video", sourceVideo: { storagePath: "owned-video" } } });
  assert.deepEqual((updated.postByChannel as Row).instagram, instagram); assert.deepEqual((updated.results as Row).instagram, original.results.instagram); assert.equal(updated.mediaType, "images"); assert.equal(updated.video, undefined); assert.equal(((updated.postByChannel as Row).facebook as Row).mediaType, "video");
});

test("the actual iNrSend save caller transmits the observed source version and a stable key without upgrading an edited baseline", async () => {
  const calls: Row[] = [], errors: string[] = [], sourceVersion = "c".repeat(64);
  const deps: Row = { detailsItem: { source: "app_events" }, detailsPayload: { publication_id: "publication" }, activeDetailsChannelEntry: { key: "facebook" }, activeDetailsChannelResult: { external_id: "current-native" }, normalizeChannelKey: (value: string) => value, activeAccountId: "account", publicationEditBaselineRef: { current: { identity: "account:publication:facebook", expectedState: Promise.resolve(sourceVersion), operationKey: "native-stable-key" } }, publicationEditForm: { title: "Titre", content: "Contenu", hashtags: "", cta: "", ctaMode: "none" }, publicationEditVideoByChannel: {}, publicationEditImagesByChannel: {},
    setDetailsActionSuccess: () => {}, setDetailsActionError: (value: string) => { if (value) errors.push(value); }, setDetailsActionBusy: () => {}, setDetailsEditMode: () => {}, loadHistory: async () => {}, i18nT: (value: string) => value, formatChannelLabel: (value: string) => value, channelApiPath: (value: string) => value,
    fetch: async (_url: string, options: { body: string }) => { calls.push(JSON.parse(options.body)); return Response.json({ ok: true }); }, getClientUserFacingErrorMessage: (error: unknown) => { throw error; },
  };
  const save = actualFunction("app/dashboard/mails/MailboxClient.tsx", "saveChannelPublication", deps) as () => Promise<void>;
  await save(); await save(); assert.equal(calls.length, 2); assert.equal(calls[0].expectedState, sourceVersion); assert.equal(calls[0].operationKey, calls[1].operationKey);
  (deps.publicationEditBaselineRef as { current: unknown }).current = null; await save(); assert.equal(calls.length, 2); assert.match(errors.at(-1)!, /version d’origine/);
});
