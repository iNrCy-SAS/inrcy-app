import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

type Role = "admin" | "staff" | "user";
type Node = { type: unknown; props: Record<string, unknown> };
const compile = (file: string) => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Node;
  return [node, ...nodes(node.props?.children)];
}

async function renderPage(actorRole: Role, accountRole: Role) {
  const actorId = "actor-test-account";
  const accountId = "active-test-account";
  const roles: Record<string, Role> = { [actorId]: actorRole, [accountId]: accountRole };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: actorId } } }) },
    from: (table: string) => {
      assert.equal(table, "profiles");
      return { select: () => ({ eq: (_column: string, id: string) => ({ maybeSingle: async () => ({ data: { role: roles[id] }, error: null }) }) }) };
    },
  };
  const loaded = new Map<string, Record<string, unknown>>();
  const observed: Array<{ accountId: string; pilot: boolean | undefined }> = [];
  function load(file: string): Record<string, unknown> {
    if (loaded.has(file)) return loaded.get(file)!;
    const loadedModule = { exports: {} as Record<string, unknown> };
    loaded.set(file, loadedModule.exports);
    const localRequire = (id: string): unknown => {
      if (id === "server-only") return {};
      if (id === "react/jsx-runtime") return { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) };
      if (id === "react") return { Suspense: "Suspense" };
      if (id === "next/server") return { NextResponse: { json: () => ({}) } };
      if (id === "next-intl/server") return { getTranslations: async () => (key: string) => key };
      if (id === "./DashboardClient") return { __esModule: true, default: "DashboardClient" };
      if (id === "./_components/ClientHydrationGate") return { __esModule: true, default: "HydrationGate" };
      if (id === "@/lib/supabaseServer") return { createSupabaseServer: async () => client };
      if (id === "@/lib/roles") return load("lib/roles.ts");
      if (id === "@/lib/metaChannelRollout") return load("lib/metaChannelRollout.ts");
      if (id === "@/lib/metaChannelRolloutServer") return load("lib/metaChannelRolloutServer.ts");
      if (id === "@/lib/multicompte/server") return { getCurrentInrcyAccountScope: async () => ({ supabase: client, scope: { activeUserId: accountId } }) };
      if (id === "@/lib/channelConnectionState") return { getChannelConnectionStates: async (database: unknown, activeId: string, _preload: unknown, options?: { metaPilotEnabled?: boolean }) => {
        assert.equal(database, client);
        observed.push({ accountId: activeId, pilot: options?.metaPilotEnabled });
        const enabled = options?.metaPilotEnabled !== false;
        return { instagram: { authMode: "instagram_login", connected: enabled }, threads: { connected: enabled }, facebook: { pageConnected: true } };
      } };
      throw new Error("Unexpected server dependency " + id);
    };
    new Function("module", "exports", "require", compile(file))(loadedModule, loadedModule.exports, localRequire);
    loaded.set(file, loadedModule.exports);
    return loadedModule.exports;
  }
  const Page = load("app/dashboard/page.tsx").default as () => Promise<Node>;
  const result = await Page();
  const dashboard = nodes(result).find(node => node.type === "DashboardClient");
  assert.ok(dashboard);
  return { dashboard, observed, accountId };
}

for (const [actorRole, accountRole, expected] of [
  ["admin", "admin", true],
  ["user", "admin", false],
  ["admin", "user", false],
  ["user", "user", false],
  ["staff", "admin", false],
] as const) {
  test("SSR channels respect actor " + actorRole + " and active account " + accountRole + " before hydration", async () => {
    // Execute the real page, getMyRole and shared actor/account rollout helper against fixture identities.
    const { dashboard, observed, accountId } = await renderPage(actorRole, accountRole);
    assert.deepEqual(observed, [{ accountId, pilot: expected }]);
    assert.equal(dashboard.props.initialOfficialChannelStatesUserId, accountId);
    const states = dashboard.props.initialOfficialChannelStates as { instagram: { connected: boolean }; threads: { connected: boolean }; facebook: { pageConnected: boolean } };
    assert.equal(states.instagram.connected, expected);
    assert.equal(states.threads.connected, expected);
    assert.equal(states.facebook.pageConnected, true, "the existing Facebook journey stays available");
  });
}
