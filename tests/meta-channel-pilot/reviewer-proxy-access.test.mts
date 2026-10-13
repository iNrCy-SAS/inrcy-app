import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as edition from "../../lib/dashboardEdition.ts";
import { FULL_PRODUCT_REVIEWER_ACCOUNT_ID } from "../../lib/reviewerAccess.ts";
import * as reviewerAccess from "../../lib/reviewerAccess.ts";
import * as accountNormalization from "../../lib/multicompte/normalize.ts";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const source = ts.transpileModule(fs.readFileSync("proxy.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function requestRoute(pathname: string, role: string, options: {
  actorId?: string;
  activeAccountId?: string;
  roleLookupFails?: boolean;
  membershipLookupFails?: boolean;
  membershipPayload?: unknown;
  status?: string;
} = {}) {
  const actorId = options.actorId || FULL_PRODUCT_REVIEWER_ACCOUNT_ID;
  const requestedProfiles: string[] = [];
  const requestedMemberships: string[] = [];
  const fetch = async (value: string) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/app_settings")) return Response.json([{ maintenance_mode: false }]);
    if (url.pathname.endsWith("/subscriptions")) return Response.json([{ status: options.status || "active", plan: "Premium", app_edition: "premium" }]);
    if (url.pathname.endsWith("/inrcy_account_members")) {
      assert.equal(url.searchParams.get("auth_user_id"), "eq." + actorId);
      assert.equal(url.searchParams.get("order"), "is_default.desc,created_at.asc");
      assert.equal(url.searchParams.get("select"), "account_id,role,is_default,inrcy_accounts!inner(display_name)");
      requestedMemberships.push(actorId);
      return options.membershipLookupFails
        ? Response.json({ error: "temporary failure" }, { status: 503 })
        : Response.json(options.membershipPayload === undefined
          ? [{ account_id: actorId, role: "owner", is_default: true, inrcy_accounts: { display_name: "Meta review" } }]
          : options.membershipPayload);
    }
    assert.equal(url.pathname, "/rest/v1/profiles");
    requestedProfiles.push(url.searchParams.get("user_id") || "");
    assert.equal(url.searchParams.get("user_id"), "eq." + actorId, "permissions are fetched for the verified session subject");
    return options.roleLookupFails ? Response.json({ error: "temporary failure" }, { status: 503 }) : Response.json([{ role }]);
  };
  const localRequire = (id: string) => {
    if (id === "next/server") return { NextRequest, NextResponse };
    if (id === "@supabase/ssr") return { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: actorId, user_metadata: { role: "reviewer" } } }, error: null }) } }) };
    if (id === "./lib/dashboardEdition") return edition;
    if (id === "./lib/reviewerAccess") return reviewerAccess;
    if (id === "./lib/multicompte/normalize") return accountNormalization;
    if (id === "./lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_COOKIE: "inrcy_uid" };
    if (id === "./lib/rateLimit") return { enforceQuota: async () => null, enforceRateLimit: async () => null };
    if (id === "./lib/actusWidgetEmbed") return { isPublicEmbedPath: () => false };
    if (id === "./lib/checkoutReturnRouting") return { CHECKOUT_RETURN_HEADER: "checkout-return", checkoutReturnQuery: () => "" };
    if (id === "./i18n/config") return {
      APP_LOCALE_COOKIE: "app-locale", APP_LOCALE_COOKIE_MAX_AGE: 3600,
      APP_LOCALE_QUERY_PARAMS: ["lang"], APP_LOCALE_REQUEST_HEADER: "app-locale",
      APP_LOCALE_SHARED_DOMAIN: ".inrcy.com", LEGACY_APP_LOCALE_COOKIE: "legacy-app-locale",
      tryNormalizeAppLocale: () => null,
    };
    throw new Error("Unexpected proxy dependency " + id);
  };
  const process = { env: { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://reviewer-fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture" } };
  const loaded = { exports: {} as { proxy: (request: unknown) => Promise<Response> } };
  new Function("module", "exports", "require", "fetch", "process", source)(loaded, loaded.exports, localRequire, fetch, process);
  const request = new NextRequest("https://app.inrcy.com" + pathname, { headers: {
    "x-reviewer-role": "reviewer", accept: "text/html",
    ...(options.activeAccountId ? { cookie: "inrcy_uid=" + options.activeAccountId } : {}),
  } });
  return { response: await loaded.exports.proxy(request), requestedProfiles, requestedMemberships };
}

test("verified reviewer can open accounting tools and call their API with a Premium subscription", async () => {
  for (const pathname of ["/dashboard/devis", "/dashboard/factures", "/api/documents", "/api/factures", "/api/inrsend/history?folder=devis"]) {
    const { response, requestedProfiles, requestedMemberships } = await requestRoute(pathname, "reviewer");
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.deepEqual(requestedProfiles, ["eq." + FULL_PRODUCT_REVIEWER_ACCOUNT_ID]);
    assert.deepEqual(requestedMemberships, [FULL_PRODUCT_REVIEWER_ACCOUNT_ID], "first login resolves the real default account before opening tools");
  }
});

test("an absent active cookie cannot carry the reviewer exception into a different default membership", async () => {
  const membershipPayload = [
    { account_id: "f164d258-45a1-436c-9bbc-abd371a19c6d", role: "member", is_default: true, inrcy_accounts: { display_name: "Other company" } },
    { account_id: FULL_PRODUCT_REVIEWER_ACCOUNT_ID, role: "owner", is_default: false, inrcy_accounts: { display_name: "Meta review" } },
  ];
  const { response: page } = await requestRoute("/dashboard/devis", "reviewer", { membershipPayload });
  assert.equal(page.status, 307);
  const { response: api } = await requestRoute("/api/documents", "reviewer", { membershipPayload });
  assert.equal(api.status, 403);
  assert.equal((await api.json()).code, "FOUNDER_REQUIRED");
  const { response: explicitOwn } = await requestRoute("/api/documents", "reviewer", { membershipPayload, activeAccountId: FULL_PRODUCT_REVIEWER_ACCOUNT_ID });
  assert.equal(explicitOwn.status, 200, "a valid explicit own-account membership still resolves to the approved review account");
});

test("default membership errors, empty results and malformed payloads all remove the review exception", async () => {
  for (const options of [
    { membershipLookupFails: true },
    { membershipPayload: [] },
    { membershipPayload: { error: "invalid result" } },
    { membershipPayload: [{ role: "owner", is_default: true }] },
  ]) {
    const { response: page } = await requestRoute("/dashboard/devis", "reviewer", options);
    assert.equal(page.status, 307);
    const { response: api } = await requestRoute("/api/documents", "reviewer", options);
    assert.equal(api.status, 403);
    assert.equal((await api.json()).code, "FOUNDER_REQUIRED");
  }
});

test("an own-account cookie cannot override a removed membership and another real default", async () => {
  const { response } = await requestRoute("/api/documents", "reviewer", {
    activeAccountId: FULL_PRODUCT_REVIEWER_ACCOUNT_ID,
    membershipPayload: [{ account_id: "f164d258-45a1-436c-9bbc-abd371a19c6d", role: "member", is_default: true }],
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FOUNDER_REQUIRED");
});

test("switching the active-account cookie away from the approved reviewer removes the full-product exception", async () => {
  const { response: own } = await requestRoute("/dashboard/devis", "reviewer", { activeAccountId: FULL_PRODUCT_REVIEWER_ACCOUNT_ID });
  assert.equal(own.status, 200);
  for (const activeAccountId of ["another-authorized-company", "f164d258-45a1-436c-9bbc-abd371a19c6d"]) {
    const { response: page } = await requestRoute("/dashboard/devis", "reviewer", { activeAccountId });
    assert.equal(page.status, 307);
    const { response: api } = await requestRoute("/api/documents", "reviewer", { activeAccountId });
    assert.equal(api.status, 403);
    assert.equal((await api.json()).code, "FOUNDER_REQUIRED");
  }
});

test("ordinary users and other reviewer accounts retain Premium boundaries despite forged role metadata and headers", async () => {
  for (const [role, actorId] of [["user", FULL_PRODUCT_REVIEWER_ACCOUNT_ID], ["reviewer", "another-reviewer"]]) {
    const { response: page } = await requestRoute("/dashboard/devis", role, { actorId });
    assert.equal(page.status, 307);
    assert.equal(page.headers.get("location"), "https://app.inrcy.com/dashboard");
    const { response: api } = await requestRoute("/api/documents", role, { actorId });
    assert.equal(api.status, 403);
    assert.equal((await api.json()).code, "FOUNDER_REQUIRED");
  }
});

test("missing role confirmation fails closed and REVIEWER cannot bypass a blocked subscription", async () => {
  const { response: failed } = await requestRoute("/api/documents", "reviewer", { roleLookupFails: true });
  assert.equal(failed.status, 403);
  assert.equal((await failed.json()).code, "FOUNDER_REQUIRED");
  const { response: blocked } = await requestRoute("/api/documents", "reviewer", { status: "canceled" });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, "ACCOUNT_BLOCKED");
});
