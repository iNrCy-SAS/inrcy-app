import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as edition from "../../lib/dashboardEdition.ts";
import { FULL_PRODUCT_REVIEWER_ACCOUNT_ID } from "../../lib/reviewerAccess.ts";
import * as reviewerAccess from "../../lib/reviewerAccess.ts";
import * as rollout from "../../lib/metaChannelRollout.ts";

type Role = "admin" | "staff" | "user" | "reviewer";
type RenderNode = { type: unknown; props: Record<string, unknown> };
const compile = (file: string) => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const jsx = (type: unknown, props: Record<string, unknown>): RenderNode => ({ type, props });
function nodes(value: unknown): RenderNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const node = value as RenderNode;
  return [node, ...nodes(node.props?.children)];
}

async function renderLayout(actorRole: Role, accountRole: Role, options: { actorId?: string; accountId?: string; accountLookupFails?: boolean; status?: string } = {}) {
  const actorId = options.actorId || FULL_PRODUCT_REVIEWER_ACCOUNT_ID;
  const accountId = options.accountId || actorId;
  const subscription = { status: options.status || "active", plan: "Premium", app_edition: "premium" };
  const database = {
    auth: { getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
    from(table: string) {
      return { select: () => ({ eq: (_column: string, id: string) => ({ maybeSingle: async () => {
        if (table === "subscriptions") return { data: subscription, error: null };
        if (table === "business_profiles") return { data: { app_language: "fr-FR" }, error: null };
        assert.equal(table, "profiles");
        if (id !== actorId && options.accountLookupFails) return { data: null, error: { message: "lookup failed" } };
        return { data: { role: id === actorId ? actorRole : accountRole }, error: null };
      } }) }) };
    },
  };
  const loadedRoles = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", compile("lib/roles.ts"))(loadedRoles, loadedRoles.exports, (id: string) => {
    if (id === "server-only") return {};
    if (id === "@/lib/supabaseServer") return { createSupabaseServer: async () => database };
    throw new Error("Unexpected role dependency " + id);
  });
  const localRequire = (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react") return {};
    if (id === "next/cache") return { unstable_noStore: () => undefined };
    if (id === "next/headers") return { headers: async () => new Headers() };
    if (id === "next-intl/server") return { getLocale: async () => "fr-FR" };
    if (id === "next/navigation") return { redirect: (destination: string) => { throw new Error("redirect:" + destination); } };
    if (id === "@/lib/supabaseServer") return { createSupabaseServer: async () => database };
    if (id === "@/lib/supabaseAdmin") return { supabaseAdmin: database };
    if (id === "@/lib/roles") return loadedRoles.exports;
    if (id === "@/lib/metaChannelRollout") return rollout;
    if (id === "@/lib/dashboardEdition") return edition;
    if (id === "@/lib/reviewerAccess") return reviewerAccess;
    if (id === "@/lib/maintenance") return { getMaintenanceState: async () => ({ enabled: false }), isAdminUser: async () => false };
    if (id === "@/lib/ensureProfileRow") return { ensureProfileRow: async () => undefined };
    if (id === "@/lib/multicompte/server") return { resolveInrcyAccountScopeForUser: async () => ({ activeUserId: accountId }) };
    if (id === "@/lib/e2eServerFlags") return { isDashboardCompletionE2EBypassEnabled: () => false };
    if (id === "@/lib/checkoutReturnRouting") return { CHECKOUT_RETURN_HEADER: "checkout-return", blockedCheckoutReturnUrl: () => "/compte-bloque" };
    if (id === "@/i18n/config") return { APP_LOCALE_REQUEST_HEADER: "app-locale", normalizeAppLocale: (value: unknown) => value, tryNormalizeAppLocale: (value: unknown) => value || null };
    if (id === "@/i18n/messages") return { loadAppMessages: async () => ({}) };
    if (id === "./_components/DashboardCompletionBypassProvider") return { DashboardCompletionBypassProvider: "DashboardCompletionBypassProvider" };
    if (id.startsWith("./_components/")) return { __esModule: true, default: id.split("/").at(-1) };
    if (id.endsWith(".css")) return { __esModule: true, default: {} };
    throw new Error("Unexpected layout dependency " + id);
  };
  const loaded = { exports: {} as { default: (props: unknown) => Promise<RenderNode> } };
  new Function("module", "exports", "require", compile("app/dashboard/layout.tsx"))(loaded, loaded.exports, localRequire);
  const tree = await loaded.exports.default({ children: "tools" });
  const editionNode = nodes(tree).find((node) => node.type === "DashboardEditionProvider");
  const accessNode = nodes(tree).find((node) => node.type === "DashboardViewerAccessProvider");
  assert.ok(editionNode);
  assert.ok(accessNode);
  return { edition: editionNode.props, access: accessNode.props, subscription };
}

test("verified Meta reviewer gets every tool and Meta pilot while commercial plan stays Premium and Admin stays false", async () => {
  const result = await renderLayout("reviewer", "reviewer");
  assert.equal(result.edition.edition, "founder");
  assert.equal(result.edition.subscriptionEdition, "premium");
  assert.equal(result.subscription.plan, "Premium");
  assert.equal(result.access.viewerMetaPilotEnabled, true);
  assert.equal(result.access.viewerIsAdmin, false);
});

test("neither an ordinary user at the approved UUID nor a different reviewer receives the special full-product edition", async () => {
  const user = await renderLayout("user", "user");
  assert.equal(user.edition.edition, "premium");
  assert.equal(user.access.viewerMetaPilotEnabled, true);
  assert.equal(user.access.viewerIsAdmin, false);
  const otherReviewer = await renderLayout("reviewer", "reviewer", { actorId: "other-reviewer" });
  assert.equal(otherReviewer.edition.edition, "premium");
  assert.equal(otherReviewer.access.viewerIsAdmin, false);
  assert.equal(otherReviewer.access.viewerMetaPilotEnabled, true);
});

test("public Meta channels work across authorized accounts while Admin and reviewer privileges remain scoped", async () => {
  for (const [actorRole, accountRole, actorId, accountId, pilotExpected, adminExpected] of [
    ["admin", "admin", "other-admin", "other-member-account", true, true],
    ["admin", "reviewer", "other-admin", FULL_PRODUCT_REVIEWER_ACCOUNT_ID, true, false],
    ["admin", "reviewer", "other-admin", "other-reviewer", true, false],
    ["reviewer", "admin", FULL_PRODUCT_REVIEWER_ACCOUNT_ID, "other-member-account", true, false],
    ["reviewer", "user", FULL_PRODUCT_REVIEWER_ACCOUNT_ID, "other-member-account", true, false],
    ["user", "reviewer", "other-user", FULL_PRODUCT_REVIEWER_ACCOUNT_ID, true, false],
    ["staff", "reviewer", "other-staff", FULL_PRODUCT_REVIEWER_ACCOUNT_ID, true, false],
  ] as const) {
    const result = await renderLayout(actorRole, accountRole, { actorId, accountId });
    assert.equal(result.access.actorUserId, actorId, "cache actor comes from the authenticated server user");
    assert.equal(result.access.activeAccountId, accountId, "actor and active establishment remain distinct");
    assert.equal(result.access.viewerMetaPilotEnabled, pilotExpected, actorRole + "/" + accountRole);
    assert.equal(result.access.viewerIsAdmin, adminExpected);
    assert.equal(result.edition.edition, "premium", "reviewer tool access cannot carry over to another active company");
  }
  const failed = await renderLayout("reviewer", "reviewer", { accountId: "other-member-account", accountLookupFails: true });
  assert.equal(failed.access.viewerMetaPilotEnabled, true);
  assert.equal(failed.access.viewerIsAdmin, false);
});

test("full-product exception requires the approved reviewer to be operating its own active account", async () => {
  const switched = await renderLayout("reviewer", "user", { accountId: "another-authorized-company" });
  assert.equal(switched.edition.edition, "premium");
  assert.equal(switched.access.viewerMetaPilotEnabled, true);
  assert.equal(switched.access.viewerIsAdmin, false);
});

test("reviewer role does not bypass the existing blocked-subscription requirement", async () => {
  await assert.rejects(renderLayout("reviewer", "reviewer", { status: "canceled" }), /redirect:\/compte-bloque/);
});
