import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { getInrAssistantNotificationNavigation, getInrAssistantNotificationTargetForHref, isInrAssistantNotificationActionRequest, parseInrAssistantNotificationNavigation } from "../../lib/inrAssistantNotificationNavigation.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ID = "30000000-0000-4000-8000-000000000003";
const statement = "Ouvre la notification « Connectez Facebook ».";
const initial = (id = ID, title = "Connectez Facebook", href = "/dashboard?panel=facebook"): Row => ({ id, user_id: ACCOUNT, category: "action", kind: "onboarding_connect_facebook", title, body: "Corps non fiable de la notification", cta_label: "Connecter Facebook", cta_url: href, read_at: null, meta: { private: "never output" }, dedupe_key: `native:${id}`, created_at: "2026-11-05T08:00:00Z" });
function harness(rows: Row[] = [initial()]) {
  const records = new Map(rows.map(value => [String(value.id), structuredClone(value)])), requests: Array<{ path: string; method: string }> = [];
  let account = ACCOUNT, actor = ACTOR, enabled = true, ignoreMark = false, markFailure = false, marks = 0, afterFeed = () => {}, afterMark = () => {}, canStart = true;
  const db = { from(table: string) {
    assert.ok(["notifications", "notification_preferences"].includes(table)); const filters: Array<[string, string, unknown]> = []; let patch: Row | null = null, head = false, start = 0, end = 1e6, single = false;
    const run = () => {
      assert.ok(filters.some(([, key]) => key === "user_id"), "every native read/update remains owned");
      const source = table === "notifications" ? [...records.values()] : [{ user_id: account, in_app_enabled: enabled }];
      const matched = source.filter(item => filters.every(([kind, key, value]) => kind === "is" ? item[key] === value : item[key] === value));
      if (patch) { marks++; assert.ok(filters.some(([, key, value]) => key === "id" && value === ID) || rows.length > 1); assert.ok(filters.some(([kind, key, value]) => kind === "is" && key === "read_at" && value === null)); if (markFailure) return { data: null, error: new Error("native_write_failed") }; if (!ignoreMark) for (const item of matched) Object.assign(item, patch); afterMark(); return { data: null, error: null }; }
      if (head) return { data: null, count: matched.length, error: null };
      const data = matched.slice(start, end + 1).map(item => structuredClone(item)); return { data: single ? data[0] ?? null : data, error: null };
    };
    const query = { select(_columns?: string, options?: { head?: boolean }) { head = options?.head === true; return query; }, eq(key: string, value: unknown) { filters.push(["eq", key, value]); return query; }, is(key: string, value: unknown) { filters.push(["is", key, value]); return query; }, order() { return query; }, range(first: number, last: number) { start = first; end = last; return query; }, abortSignal() { return query; }, update(value: Row) { patch = value; return query; }, maybeSingle: async () => { single = true; return run(); }, then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve().then(run).then(resolve, reject); } }; return query;
  } };
  const auth = async () => ({ activeUserId: account, authUserId: actor });
  const native = runtimeModules({ "next/server": { NextResponse: { json: Response.json } }, "@/lib/requireUser": { requireUser: auth }, "@/lib/supabaseAdmin": { supabaseAdmin: db }, "@/lib/notificationWriter": { insertNotificationOnce: () => assert.fail("No notification may be created") }, "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "indisponible" }, { status: 503 }) } });
  const feed = native<typeof import("../../app/api/notifications/feed/route.ts")>("app/api/notifications/feed/route.ts"), mark = native<typeof import("../../app/api/notifications/[id]/read/route.ts")>("app/api/notifications/[id]/read/route.ts"), projection = native<typeof import("../../lib/notifications.ts")>("lib/notifications.ts");
  const factory = runtimeModules({ "./requireUser": { requireUser: auth }, "./notifications": projection,
    "@/app/api/notifications/feed/route": { GET: async (request: Request) => { requests.push({ path: new URL(request.url).pathname + new URL(request.url).search, method: request.method }); assert.equal(request.headers.get("cookie"), "session=fixture"); assert.equal(request.headers.has("x-cron-secret"), false); const response = await feed.GET(request); afterFeed(); return response; } },
    "@/app/api/notifications/[id]/read/route": { POST: async (request: Request, context: { params: Promise<{ id: string }> }) => { requests.push({ path: new URL(request.url).pathname, method: request.method }); return mark.POST(request, context); } },
  })<typeof import("../../lib/inrAssistantNotificationNavigationTools.ts")>("lib/inrAssistantNotificationNavigationTools.ts");
  const create = (message = statement) => factory.createInrAssistantNotificationNavigationTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=fixture", "x-cron-secret": "never-forward" } }), accountId: ACCOUNT, actorUserId: ACTOR, edition: "basic", supabase: db as never, currentUserMessage: message, canStartWork: () => canStart, clientContext: { source: "untrusted_client", interfaces: [{ id: "notification_menu", revision: "native_menu_revision", operations: ["close"] }] } });
  const run = async (message = statement, selector: { notificationId: string | null; title: string | null } = { notificationId: null, title: "Connectez Facebook" }, tools = create(message)) => await tools.openNotificationAction.execute!({ ...selector, instructionQuote: message }, { toolCallId: "notification", messages: [] }) as Row;
  return { run, create, records, requests, projection, get marks() { return marks; }, setAccount: () => { account = "foreign"; }, setActor: () => { actor = "foreign"; }, disabled: () => { enabled = false; }, ignore: () => { ignoreMark = true; }, markFailure: () => { markFailure = true; }, stop: () => { canStart = false; }, afterFeed: (callback: () => void) => { afterFeed = callback; }, afterMark: (callback: () => void) => { afterMark = callback; } };
}

test("Basic notification CTA uses the real owned native feed and read route then verified read_at before requesting canonical navigation", async () => {
  const h = harness(), tools = h.create(), [result, duplicate] = await Promise.all([h.run(undefined, undefined, tools), h.run(undefined, undefined, tools)]);
  assert.equal(result.ok, true); assert.equal(result.status, "navigation_requested"); assert.equal(result.markedRead, true); assert.deepEqual(duplicate, result); assert.equal(h.marks, 1); assert.ok(h.records.get(ID)?.read_at);
  assert.deepEqual(result.navigation, { destination: "notification", notificationId: ID, notificationTarget: "facebook", href: "/dashboard?panel=facebook", label: "Facebook", notificationMenuRevision: "native_menu_revision" });
  assert.match(String(result.message), /demandée au navigateur/); assert.doesNotMatch(String(result.message), /page ouverte|écran ouvert/); assert.doesNotMatch(JSON.stringify(result), /never output|Corps non fiable|dedupe_key|session=fixture|x-cron-secret/);
  assert.deepEqual(h.requests.map(request => request.method), ["GET", "POST"]);
  h.setActor(); assert.equal((await h.run(undefined, undefined, tools)).ok, false, "cached receipts reauthenticate the actor"); assert.equal(h.marks, 1);
});

test("notification navigation requires the literal current target and rejects quotes help conditions invented selectors and ambiguous titles", async () => {
  for (const message of ["Comment ouvrir la notification Connectez Facebook ?", "Peux-tu m’expliquer comment ouvrir la notification Connectez Facebook ?", "« Ouvre la notification Connectez Facebook. »", "Si je confirme, ouvre la notification Connectez Facebook.", "N’ouvre pas la notification Connectez Facebook.", "Ouvre mon canal Facebook.", "Ouvre la notification Connectez Instagram."]) { const h = harness(); assert.equal((await h.run(message)).ok, false, message); assert.equal(h.marks, 0); }
  const id = harness(); assert.equal((await id.run(statement, { notificationId: ID, title: null })).ok, false, "an ID supplied only by the model cannot replace the user's titled target");
  assert.equal((await id.run(`Peux-tu ouvrir la notification ${ID} ?`, { notificationId: ID, title: null })).ok, true);
  const otherId = "30000000-0000-4000-8000-000000000004", duplicates = harness([initial(), initial(otherId)]); assert.equal((await duplicates.run()).ok, false); assert.equal(duplicates.marks, 0);
  const disabled = harness(); disabled.disabled(); assert.equal((await disabled.run()).ok, false); assert.equal(disabled.marks, 0);
});

test("notification action intent leaves the bell and notification list to their native menu without marking a selected item", () => {
  for (const message of ["Ouvre les notifications.", "Peux-tu afficher mes notifications ?", "Ouvre la cloche des notifications.", "Ouvre le menu des notifications.", "Ouvre la notification.", "Ouvre la notification suivante."]) assert.equal(isInrAssistantNotificationActionRequest(message), false, message);
  for (const message of [statement, `Peux-tu ouvrir la notification ${ID} ?`, "Ouvre le bouton de la notification « Connectez Facebook ».", "Ouvre la notification intitulée Connectez Facebook."]) assert.equal(isInrAssistantNotificationActionRequest(message), true, message);
});

test("notification CTA validation rejects foreign paid external API and arbitrary query links before marking anything read", async () => {
  for (const href of ["https://foreign.test/dashboard", "javascript:alert(1)", "/api/media-generation/generate", "/auth/callback", "/dashboard/crm", "/dashboard/agenda?request=30000000-0000-4000-8000-000000000004", "/dashboard/admin/trials?focus=someone", "/dashboard?panel=mails", "/dashboard?panel=facebook&publish=1", "/dashboard?panel=google_stats"]) { const h = harness([initial(ID, "Connectez Facebook", href)]); const result = await h.run(); assert.equal(result.ok, false, href); assert.equal(h.marks, 0); assert.equal(h.records.get(ID)?.read_at, null); }
  for (const mutate of [(h: ReturnType<typeof harness>) => h.setAccount(), (h: ReturnType<typeof harness>) => h.setActor(), (h: ReturnType<typeof harness>) => h.stop()]) { const h = harness(); mutate(h); assert.equal((await h.run()).ok, false); assert.equal(h.marks, 0); }
});

test("notification readback never navigates on a changed source failed write unconfirmed marker or replaced actor", async () => {
  const changed = harness(); changed.afterFeed(() => { changed.records.get(ID)!.cta_url = "/dashboard/stats"; }); assert.equal((await changed.run()).ok, false); assert.equal(changed.marks, 0);
  for (const configure of [(h: ReturnType<typeof harness>) => h.ignore(), (h: ReturnType<typeof harness>) => h.markFailure(), (h: ReturnType<typeof harness>) => h.afterMark(() => { h.records.get(ID)!.body = "Changed"; }), (h: ReturnType<typeof harness>) => h.afterMark(() => h.setActor())]) { const h = harness(); configure(h); const result = await h.run(); assert.equal(result.ok, false); assert.equal(result.navigation, undefined); assert.equal(h.marks, 1); }
  const cached = harness(), tools = cached.create(); assert.equal((await cached.run(undefined, undefined, tools)).ok, true); cached.records.get(ID)!.cta_url = "/dashboard/stats"; assert.equal((await cached.run(undefined, undefined, tools)).ok, false); assert.equal(cached.marks, 1, "cached navigation cannot ignore a changed notification");
});

test("notification title uniqueness follows actual native pagination and refuses an incomplete catalogue instead of choosing the first match", async () => {
  const others = Array.from({ length: 51 }, (_, index) => initial(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`, `Autre ${index}`));
  const ambiguous = harness([initial(), ...others, initial("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")]); assert.equal((await ambiguous.run()).ok, false); assert.equal(ambiguous.marks, 0); assert.equal(ambiguous.requests.length, 2);
  const many = harness([initial(), ...Array.from({ length: 500 }, (_, index) => initial(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`, `Autre ${index}`))]); assert.equal((await many.run()).status, "needs_instruction"); assert.equal(many.marks, 0); assert.equal(many.requests.length, 10);
});

test("notification navigation reconstructs finite native destinations and current legacy Stats profile GPS and Basic planning paths", () => {
  const h = harness(), oldStats = initial(ID, "Connecter les stats", "/dashboard?panel=google_stats"); oldStats.kind = "connect_stats";
  const projected = h.projection.toNotificationPayload(oldStats as never); assert.equal(projected.cta_url, "/dashboard?panel=site_web"); assert.equal(projected.cta_label, "Connecter les statistiques du site");
  assert.equal(h.projection.toNotificationPayload({ ...oldStats, kind: "unrelated" } as never).cta_url, "/dashboard?panel=google_stats"); assert.equal(h.projection.toNotificationPayload({ ...oldStats, cta_url: "/dashboard/stats" } as never).cta_url, "/dashboard/stats");
  for (const [source, target, href] of [["/dashboard/gps", "help", "/dashboard?help=1"], ["/dashboard/mon-profil?section=activity", "dna_activity", "/dashboard/adn-entreprise?tab=activity"], ["/dashboard/mon-profil", "dna_profile", "/dashboard/adn-entreprise?tab=profile"], ["/dashboard/agent", "agents", "/dashboard/agent/publications"], [projected.cta_url, "website", "/dashboard?panel=site_web"]]) { assert.equal(getInrAssistantNotificationTargetForHref(source), target); const navigation = getInrAssistantNotificationNavigation(ID, target); assert.equal(navigation?.href, href); assert.deepEqual(parseInrAssistantNotificationNavigation(navigation), navigation); assert.equal(parseInrAssistantNotificationNavigation({ ...navigation, href: "/dashboard/ads" }), null); }
  const cron = readFileSync(new URL("../../app/api/cron/notifications/route.ts", import.meta.url), "utf8"); assert.match(cron, /ctaLabel = "Connecter les statistiques du site";\s+ctaUrl = "\/dashboard\?panel=site_web";\s+kind = "connect_stats"/); assert.doesNotMatch(cron, /panel=google_stats/);
  assert.match(readFileSync(new URL("../../app/dashboard/gps/page.tsx", import.meta.url), "utf8"), /redirect\("\/dashboard\?help=1"\)/); assert.match(readFileSync(new URL("../../app/dashboard/mon-profil/page.tsx", import.meta.url), "utf8"), /section\) === "activity" \? "activity" : "profile"/);
  assert.equal(parseInrAssistantNotificationNavigation({ ...getInrAssistantNotificationNavigation(ID, "facebook"), arbitrary: true }), null);
});
