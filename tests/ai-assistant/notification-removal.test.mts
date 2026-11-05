import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ID = "30000000-0000-4000-8000-000000000003", OTHER = "40000000-0000-4000-8000-000000000004";
function fixture(options: { race?: boolean; ignoreDelete?: boolean } = {}) {
  let account = ACCOUNT, actor = ACTOR, reads = 0, writes = 0;
  const notifications: Row[] = [{ id: ID, user_id: ACCOUNT, title: "Publication terminée", body: "Statut de la publication", category: "publish", kind: "success", cta_label: null, cta_url: null, read_at: null, meta: { event: "retained-event" }, dedupe_key: "native", created_at: "2026-11-05T10:00:00.000Z" }];
  const db = { from(table: string) {
    assert.equal(table, "notifications"); const filters: Array<[string, unknown]> = []; let deleting = false;
    const query = { select() { return query; }, eq(field: string, value: unknown) { filters.push([field, value]); return query; }, is(field: string, value: unknown) { filters.push([field, value]); return query; }, delete() { deleting = true; if (options.race && notifications[0]) notifications[0].title = "Concurrent change"; return query; }, async maybeSingle() {
      if (!deleting) reads++;
      const selected = notifications.find(item => filters.every(([field, value]) => JSON.stringify(item[field] ?? null) === JSON.stringify(typeof value === "string" && value.startsWith("{") ? JSON.parse(value) : value)));
      if (deleting && selected) { writes++; if (!options.ignoreDelete) notifications.splice(notifications.indexOf(selected), 1); }
      return { data: selected ? structuredClone(selected) : null, error: null };
    }, then(resolve: (value: { data: Row | null; error: null }) => unknown) { return query.maybeSingle().then(resolve);
    } }; return query;
  } };
  const auth = { requireUser: async () => ({ activeUserId: account, authUserId: actor }) };
  const load = runtimeModules({ "./requireUser": auth, "@/lib/requireUser": auth, "@/lib/supabaseAdmin": { supabaseAdmin: db }, "next/server": { NextResponse: { json: Response.json } }, "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "fixture" }, { status: 500 }) } });
  const runtime = load<typeof import("../../lib/inrAssistantAccountServiceTools.ts")>("lib/inrAssistantAccountServiceTools.ts"), tokens = new Map<string, string>();
  const create = (message: string) => runtime.createInrAssistantAccountServiceTools({ request: new Request("https://app.example/api/assistant/chat"), accountId: ACCOUNT, actorUserId: ACTOR, currentUserMessage: message, resolvePreview: reference => tokens.get(reference) || null, supabase: db as never });
  const preview = async (message = `Supprime la notification ${ID}.`) => {
    const result = await create(message).previewNotificationRemoval.execute!({ notificationId: ID, instructionQuote: message }, { toolCallId: "preview", messages: [] }) as Row;
    if (typeof result.reference === "string" && typeof result.token === "string") tokens.set(result.reference, result.token); return result;
  };
  const apply = (reference: string, message = `Confirme ${reference}`) => { const tools = create(message); return () => tools.applyNotificationRemoval.execute!({ reference, instructionQuote: message }, { toolCallId: "apply", messages: [] }) as Promise<Row>; };
  return { notifications, tokens, preview, apply, create, load, stats: () => ({ reads, writes }), changeAccount: () => { account = OTHER; }, changeActor: () => { actor = OTHER; } };
}
const signed = async (run: () => Promise<void>) => { const before = process.env.INRCY_ASSISTANT_APPROVAL_SECRET; process.env.INRCY_ASSISTANT_APPROVAL_SECRET = "native-notification-test-signature-key-123456789"; try { await run(); } finally { if (before === undefined) delete process.env.INRCY_ASSISTANT_APPROVAL_SECRET; else process.env.INRCY_ASSISTANT_APPROVAL_SECRET = before; } };
test("Basic notification removal previews one exact native record and only the confirmed atomic deletion plus absence is successful", async () => signed(async () => {
  const h = fixture(), preview = await h.preview(); assert.equal(preview.status, "preview_ready"); assert.equal(h.stats().writes, 0); assert.equal(h.notifications.length, 1);
  const apply = h.apply(String(preview.reference)); const [first, duplicate] = await Promise.all([apply(), apply()]); assert.equal(first.status, "deleted"); assert.deepEqual(duplicate, first); assert.equal(h.stats().writes, 1); assert.equal(h.notifications.length, 0);
  const repeated = await h.apply(String(preview.reference))(); assert.equal(repeated.status, "already_absent"); assert.equal(repeated.changed, false); assert.equal(h.stats().writes, 1);
}));
test("Basic notification removal rejects wrong targets quoted instructions scope drift state conflicts and false native success", async () => signed(async () => {
  const h = fixture();
  for (const message of ["Supprime cette notification.", `Comment supprimer la notification ${ID} ?`, `Lis ceci : 'Supprime la notification ${ID}.'`, `Si je confirme supprime la notification ${ID}.`, `Ne supprime pas la notification ${ID}.`]) assert.equal((await h.preview(message)).ok, false, message);
  for (const change of ["actor", "account", "state"] as const) { const current = fixture(), preview = await current.preview(); if (change === "actor") current.changeActor(); if (change === "account") current.changeAccount(); if (change === "state") current.notifications[0].read_at = "2026-11-05T11:00:00Z";
    assert.equal((await current.apply(String(preview.reference))()).ok, false, change); assert.equal(current.stats().writes, 0, change);
  }
  const raced = fixture({ race: true }), preview = await raced.preview(); assert.equal((await raced.apply(String(preview.reference))()).status, "conflict"); assert.equal(raced.stats().writes, 0); assert.equal(raced.notifications.length, 1);
  const ignored = fixture({ ignoreDelete: true }), approved = await ignored.preview(); assert.equal((await ignored.apply(String(approved.reference))()).status, "unknown"); assert.equal(ignored.notifications.length, 1);
}));
test("native notification DELETE rejects an invalid account actor or fingerprint before deletion and preserves legacy personal calls", async () => {
  const h = fixture(), route = h.load<typeof import("../../app/api/notifications/[id]/route.ts")>("app/api/notifications/[id]/route.ts");
  for (const body of [{ expectedAccountId: OTHER, expectedActorUserId: ACTOR, expectedFingerprint: "a".repeat(64) }, { expectedAccountId: ACCOUNT, expectedActorUserId: OTHER, expectedFingerprint: "a".repeat(64) }, { expectedAccountId: ACCOUNT }]) {
    const response = await route.DELETE(new Request(`https://app.example/api/notifications/${ID}`, { method: "DELETE", body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) }); assert.equal(response.status, 409); assert.equal(h.stats().reads, 0); assert.equal(h.stats().writes, 0);
  }
  const fingerprintResponse = await route.DELETE(new Request(`https://app.example/api/notifications/${ID}`, { method: "DELETE", body: JSON.stringify({ expectedAccountId: ACCOUNT, expectedActorUserId: ACTOR, expectedFingerprint: "a".repeat(64) }) }), { params: Promise.resolve({ id: ID }) }); assert.equal(fingerprintResponse.status, 409); assert.equal(h.stats().reads, 1); assert.equal(h.stats().writes, 0);
  const legacy = await route.DELETE(new Request(`https://app.example/api/notifications/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID }) }); assert.equal(legacy.status, 200); assert.equal(h.stats().writes, 1); assert.equal(h.notifications.length, 0);
});
