import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { isInrAssistantBadgeLogoThemeRequest, parseInrAssistantBadgeIdentityThemeCommand } from "../../lib/inrAssistantBadgeIdentityTheme.ts";
import { isInrAssistantLocalInterfaceRequest } from "../../lib/inrAssistantLocalInterface.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", OTHER = "30000000-0000-4000-8000-000000000003";
test("Basic Badge logo theme tool only prepares native extraction for the explicit displayed logo scope and exact current revision", async () => {
  let actor = ACTOR, account = ACCOUNT, allowed = true;
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) } }), runtime = load<typeof import("../../lib/inrAssistantBadgeIdentityThemeUiTools.ts")>("lib/inrAssistantBadgeIdentityThemeUiTools.ts");
  const run = async (message = "Actualise les couleurs du thème du Badge depuis mon logo.", revision = "badge_native", hint = true) => {
    const tool = runtime.createInrAssistantBadgeIdentityThemeUiTools({ accountId: ACCOUNT, actorUserId: ACTOR, currentUserMessage: message, canStartWork: () => allowed, clientContext: hint ? { source: "untrusted_client", interfaces: [{ id: "badge_identity_theme", revision: "badge_native", operations: ["retry"] }] } : null }).refreshBadgeThemeFromLogo;
    return await tool.execute!({ revision, instructionQuote: message }, { toolCallId: "badge-logo", messages: [] }) as Row;
  };
  const result = await run(); assert.equal(result.status, "ui_action_requested"); assert.deepEqual(parseInrAssistantBadgeIdentityThemeCommand(result.uiCommand), { command: "refresh_badge_theme_from_logo", selection: { kind: "channel", id: "inrbadge" }, revision: "badge_native" }); assert.doesNotMatch(JSON.stringify(result), /#[0-9a-f]{6}|https:|logo\.png/i);
  for (const message of ["Comment actualiser les couleurs du Badge depuis le logo ?", "Lis ceci : 'Applique les couleurs du logo au thème du Badge.'", "N’applique pas les couleurs du logo au Badge.", "Demain actualise le thème Badge depuis mon logo.", "Crée une image avec mon logo Badge.", "Vérifie mes crédits puis décris le thème de mon logo Badge."]) { assert.equal(isInrAssistantBadgeLogoThemeRequest(message), false, message); assert.equal((await run(message)).ok, false); }
  assert.equal((await run(undefined, "stale")).ok, false); assert.equal((await run(undefined, undefined, false)).ok, false);
  for (const change of ["actor", "account", "budget"] as const) { actor = ACTOR; account = ACCOUNT; allowed = true; if (change === "actor") actor = OTHER; if (change === "account") account = OTHER; if (change === "budget") allowed = false; assert.equal((await run()).status, "blocked"); }
  assert.equal(isInrAssistantLocalInterfaceRequest("Actualise les couleurs du thème du Badge depuis mon logo.", "badge_identity_theme", "retry"), false);
  assert.equal(parseInrAssistantBadgeIdentityThemeCommand({ command: "refresh_badge_theme_from_logo", selection: { kind: "channel", id: "inrbadge" }, revision: "badge_native", palette: { primary: "#FF0000" } }), null);
});

test("Basic native Badge theme guard compares trusted scope and the complete stored settings atomically before accepting a logo palette", async () => {
  const before = { id: "aurora", identityColors: null }, next = { id: "identity", identityColors: { primary: "#D80000", secondary: "#0048D8", accent: "#00D848" } };
  for (const mode of ["ok", "wrong_account", "wrong_actor", "partial_guard", "invalid_theme", "stale_theme", "concurrent_other_setting", "aborted"] as const) {
    let writes = 0, reads = 0; let stored: Row = { user_id: ACCOUNT, settings: { inrBadgeTheme: before, studio: { retained: "native" }, untouched: ["A", "B"] } };
    const original = structuredClone(stored);
    const supabase = { from(table: string) { assert.equal(table, "pro_tools_configs"); let patch: Row | null = null; const filters: Array<[string, unknown]> = []; const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, is(key: string, value: unknown) { filters.push([key, value]); return query; },
      update(value: Row) { patch = value; if (mode === "concurrent_other_setting") stored = { ...stored, settings: { ...(stored.settings as Row), studio: { retained: "new manual setting" } } }; return query; }, insert() { assert.fail("This fixture owns an existing configuration"); }, upsert() { assert.fail("A guarded assistant request must use atomic compare-and-set, never unconditional upsert"); },
      async maybeSingle() { if (!patch) { reads++; return { data: structuredClone(stored), error: null }; } assert.ok(filters.some(([key]) => key === "settings"), "The atomic predicate must include the complete JSON value"); if (!filters.every(([key, value]) => JSON.stringify(stored[key]) === JSON.stringify(value))) return { data: null, error: null }; stored = { ...stored, ...patch }; writes++; return { data: { user_id: ACCOUNT }, error: null }; },
    }; return query; } };
    const load = runtimeModules({ "@/lib/requireUser": { requireUser: async () => ({ supabase, user: { id: ACTOR }, authUserId: ACTOR, activeUserId: ACCOUNT }) }, "next/server": { NextResponse: { json: Response.json } }, "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async () => "basic" }, "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async () => false }, "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ ok: false }, { status: 500 }) } });
    const route = load<typeof import("../../app/api/inrbadge/settings/route.ts")>("app/api/inrbadge/settings/route.ts"), controller = new AbortController();
    const body: Row = { theme: next, expectedAccountId: mode === "wrong_account" ? OTHER : ACCOUNT, expectedActorUserId: mode === "wrong_actor" ? OTHER : ACTOR, expectedTheme: mode === "stale_theme" ? { id: "ocean", identityColors: null } : mode === "invalid_theme" ? { invented: true } : before };
    if (mode === "partial_guard") delete body.expectedActorUserId; if (mode === "aborted") controller.abort();
    const response = await route.PATCH(new Request("https://app.fixture.invalid/api/inrbadge/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }));
    assert.equal(response.status, mode === "ok" ? 200 : 409, mode); assert.equal(writes, mode === "ok" ? 1 : 0, mode);
    if (["wrong_account", "wrong_actor", "partial_guard", "invalid_theme", "aborted"].includes(mode)) assert.equal(reads, 0, mode);
    const settings = stored.settings as Row; assert.deepEqual(settings.untouched, (original.settings as Row).untouched); assert.deepEqual(settings.studio, mode === "concurrent_other_setting" ? { retained: "new manual setting" } : (original.settings as Row).studio);
    if (mode === "ok") { const get = await route.GET(), data = await get.json(); assert.equal(data.accountId, ACCOUNT); assert.equal(data.actorAuthUserId, ACTOR); assert.equal(data.theme.id, "identity"); }
  }
});
