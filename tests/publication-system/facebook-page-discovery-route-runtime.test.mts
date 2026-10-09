import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { asRecord, asString } from "../../lib/tsSafe.ts";

type PermissionCheck = {
  permissions: Record<string, string>;
  issue: Record<string, unknown> | null;
};
type Discovery = {
  pages: Array<Record<string, unknown>>;
  diagnostics: {
    token_count: number;
    successful_token_count: number;
    recovered_token_count: number;
    issues: Array<Record<string, unknown>>;
  };
};
type Options = {
  authDenied?: boolean;
  authError?: boolean;
  tokens?: string[];
  integration?: Record<string, unknown> | null;
  integrationError?: Record<string, unknown>;
  discovery?: Discovery;
  permissions?: Record<string, PermissionCheck>;
};

const authUserId = "authenticated-member";
const activeUserId = "active-owned-account";
const requiredPermissions = ["pages_show_list", "pages_read_engagement"];
const completePermissions: PermissionCheck = {
  permissions: {
    public_profile: "granted",
    email: "granted",
    pages_show_list: "granted",
    pages_read_engagement: "granted",
    pages_manage_posts: "granted",
    read_insights: "granted",
  },
  issue: null,
};
const issue = {
  stage: "me_accounts_basic",
  optional: false,
  status: 500,
  code: 2,
  subcode: null,
  type: "OAuthException",
  fbtrace_id: "provider-private-trace",
  message: "provider-private-message synthetic-user-token",
};
const emptyDiscovery = (successfulTokenCount = 1): Discovery => ({
  pages: [],
  diagnostics: {
    token_count: 1,
    successful_token_count: successfulTokenCount,
    recovered_token_count: 0,
    issues: successfulTokenCount === 0 ? [issue] : [],
  },
});

function runtime(options: Options = {}) {
  const calls: Array<{ kind: string; value?: unknown }> = [];
  const logs: unknown[] = [];
  const tokens = options.tokens ?? ["synthetic-user-token"];
  const encryptedTokens = tokens.map((token) => `encrypted:${token}`);
  const integration = Object.hasOwn(options, "integration")
    ? options.integration
    : {
        status: "account_connected",
        access_token_enc: "encrypted:integration-fallback-token",
        meta: { user_access_token_enc: encryptedTokens[0] },
      };
  const query = {
    select: (columns: string) => { calls.push({ kind: "select", value: columns }); return query; },
    eq: (column: string, value: unknown) => { calls.push({ kind: "eq", value: [column, value] }); return query; },
    maybeSingle: async () => {
      calls.push({ kind: "integration-read" });
      return { data: integration, error: options.integrationError ?? null };
    },
    insert: () => { throw new Error("Discovery must never insert data"); },
    update: () => { throw new Error("Discovery must never update data"); },
    upsert: () => { throw new Error("Discovery must never upsert data"); },
    delete: () => { throw new Error("Discovery must never delete data"); },
  };
  const database = {
    from: (table: string) => {
      calls.push({ kind: "table", value: table });
      assert.equal(table, "integrations");
      return query;
    },
  };
  const supabase = {
    ...database,
    auth: {
      getUser: async () => {
        calls.push({ kind: "auth" });
        return {
          data: { user: options.authDenied ? null : { id: authUserId } },
          error: options.authError ? { message: "auth failure" } : null,
        };
      },
    },
  };
  const captureLog = (message: unknown, context: unknown) => logs.push({ message, context });
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => supabase },
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/multicompte/server": {
      resolveActiveInrcyAccountId: async (client: unknown, userId: string) => {
        calls.push({ kind: "active-scope", value: userId });
        assert.equal(client, supabase);
        assert.equal(userId, authUserId);
        return activeUserId;
      },
    },
    "@/lib/oauthCrypto": {
      tryDecryptToken: (encrypted: string) => {
        calls.push({ kind: "decrypt", value: encrypted });
        assert.ok(encryptedTokens.includes(encrypted));
        return encrypted.slice("encrypted:".length);
      },
    },
    "@/lib/tsSafe": { asRecord, asString },
    "@/lib/apiUserFacingErrors": {
      jsonUserFacingError: (_error: unknown, options: { status?: number } = {}) =>
        Response.json({ error: "Public sanitized error" }, { status: options.status ?? 500 }),
    },
    "@/lib/metaBusinessAssets": {
      extractFacebookUserTokens: (metadata: unknown, fallback: string | null) => {
        calls.push({ kind: "extract" });
        assert.deepEqual(metadata, asRecord(integration?.meta));
        assert.equal(fallback, asString(integration?.access_token_enc));
        return encryptedTokens;
      },
      listAccessibleFacebookPagesFromTokensDetailed: async (receivedTokens: string[]) => {
        calls.push({ kind: "discovery", value: receivedTokens });
        assert.deepEqual(receivedTokens, Array.from(new Set(tokens)));
        return options.discovery ?? emptyDiscovery();
      },
      inspectFacebookUserTokenPermissions: async (token: string) => {
        calls.push({ kind: "permission", value: token });
        assert.ok(tokens.includes(token));
        return options.permissions?.[token] ?? completePermissions;
      },
    },
    "@/lib/observability/logger": { log: { info: captureLog, warn: captureLog, error: captureLog } },
  };
  const source = readFileSync(new URL("../../app/api/integrations/facebook/pages/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { GET?: () => Promise<Response> } = {};
  new Function("exports", "require", compiled)(exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected route dependency: ${name}`);
    return modules[name];
  });
  return { calls, logs, run: () => exports.GET!() };
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /(?:^|[,\s])no-store(?:$|[,\s])/);
}

function assertNoPrivateProperties(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /access_token|_enc$|^meta$|^diagnostics$|^issues$|^fbtrace_id$/i);
    assertNoPrivateProperties(child);
  }
}

test("Facebook discovery returns public Page identities with no tokens, raw diagnostics or cache", async () => {
  const harness = runtime({
    discovery: {
      pages: [{
        id: "1087954914395950",
        name: "Page vérifiée",
        access_token: "synthetic-page-token",
        access_token_enc: "encrypted:synthetic-page-token",
        source: "page_lookup",
        business_id: "business-public-id",
        business_name: "Entreprise",
        instagram_business_account: { id: "instagram-public-id", username: "compte", access_token: "nested-private-token" },
        meta: { internal: "provider-private-message" },
      }],
      diagnostics: { token_count: 1, successful_token_count: 1, recovered_token_count: 1, issues: [issue] },
    },
  });
  const response = await harness.run();
  assert.equal(response.status, 200);
  assertNoStore(response);
  const body = await response.json();
  assert.equal(body.pages.length, 1);
  assert.equal(body.pages[0].id, "1087954914395950");
  assert.equal(body.pages[0].name, "Page vérifiée");
  assertNoPrivateProperties(body);
  assert.doesNotMatch(JSON.stringify(body), /synthetic-.*token|encrypted:|nested-private|provider-private/);
  assert.equal(harness.calls.some((call) => call.kind === "permission"), false);
  assert.ok(harness.calls.some((call) => call.kind === "eq" && JSON.stringify(call.value) === JSON.stringify(["user_id", activeUserId])));
  for (const [column, value] of [["provider", "facebook"], ["source", "facebook"], ["product", "facebook"]]) {
    assert.ok(harness.calls.some((call) => call.kind === "eq" && JSON.stringify(call.value) === JSON.stringify([column, value])));
  }
});

test("Facebook discovery rejects unauthenticated requests before scope, database or native reads", async () => {
  for (const options of [{ authDenied: true }, { authError: true }]) {
    const harness = runtime(options);
    const response = await harness.run();
    assert.equal(response.status, 401);
    assertNoStore(response);
    assert.deepEqual(harness.calls, [{ kind: "auth" }]);
  }
});

test("Facebook discovery cannot use a missing or disconnected integration", async () => {
  for (const integration of [null, { status: "disconnected", access_token_enc: "encrypted:unused" }, { status: "connected", access_token_enc: null }]) {
    const harness = runtime({ integration });
    const response = await harness.run();
    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.equal(harness.calls.some((call) => ["decrypt", "discovery", "permission"].includes(call.kind)), false);
  }
});

test("Facebook discovery identifies only the two reading permissions actually missing", async () => {
  for (const missing of [requiredPermissions, [requiredPermissions[0]], [requiredPermissions[1]]]) {
    const permissions = { ...completePermissions.permissions };
    for (const permission of missing) permissions[permission] = "declined";
    const harness = runtime({ permissions: { "synthetic-user-token": { permissions, issue: null } } });
    const response = await harness.run();
    assert.equal(response.status, 409);
    assertNoStore(response);
    const body = await response.json();
    assert.equal(body.code, "facebook_permissions_incomplete");
    assert.deepEqual([...body.missing_permissions].sort(), [...missing].sort());
    assertNoPrivateProperties(body);
  }
});

test("Facebook discovery does not require Instagram or posting permissions to list Facebook Pages", async () => {
  const harness = runtime({
    permissions: { "synthetic-user-token": { permissions: { pages_show_list: "granted", pages_read_engagement: "granted" }, issue: null } },
  });
  const response = await harness.run();
  assert.equal(response.status, 409);
  assertNoStore(response);
  assert.equal((await response.json()).code, "facebook_pages_not_returned");
});

test("Facebook discovery returns 502 when all native reads fail instead of a successful empty list", async () => {
  const harness = runtime({ discovery: emptyDiscovery(0) });
  const response = await harness.run();
  assert.equal(response.status, 502);
  assertNoStore(response);
  const body = await response.json();
  assert.equal(body.code, "meta_page_discovery_failed");
  assert.equal(Object.hasOwn(body, "pages"), false);
  assertNoPrivateProperties(body);
  assert.doesNotMatch(JSON.stringify(body), /provider-private|synthetic-user-token/);
});

test("Facebook discovery distinguishes a valid empty native list from a provider failure", async () => {
  const harness = runtime({ discovery: emptyDiscovery(1) });
  const response = await harness.run();
  assert.equal(response.status, 409);
  assertNoStore(response);
  const body = await response.json();
  assert.equal(body.code, "facebook_pages_not_returned");
  assert.equal(Object.hasOwn(body, "pages"), false);
});

test("Facebook discovery does not report missing permissions when another token has both grants", async () => {
  const harness = runtime({
    tokens: ["synthetic-incomplete-token", "synthetic-complete-token"],
    discovery: { ...emptyDiscovery(1), diagnostics: { ...emptyDiscovery(1).diagnostics, token_count: 2 } },
    permissions: {
      "synthetic-incomplete-token": { permissions: {}, issue: null },
      "synthetic-complete-token": completePermissions,
    },
  });
  const response = await harness.run();
  assert.equal(response.status, 409);
  assertNoStore(response);
  const body = await response.json();
  assert.equal(body.code, "facebook_pages_not_returned");
  assert.equal(Object.hasOwn(body, "missing_permissions"), false);
  assert.equal(harness.calls.filter((call) => call.kind === "permission").length, 2);
});

test("Facebook discovery cannot infer missing grants from an unsuccessful permission inspection", async () => {
  for (const successfulTokenCount of [0, 1]) {
    const harness = runtime({
      tokens: ["synthetic-incomplete-token", "synthetic-unavailable-token"],
      discovery: { ...emptyDiscovery(successfulTokenCount), diagnostics: { ...emptyDiscovery(successfulTokenCount).diagnostics, token_count: 2 } },
      permissions: {
        "synthetic-incomplete-token": { permissions: {}, issue: null },
        "synthetic-unavailable-token": { permissions: {}, issue },
      },
    });
    const response = await harness.run();
    assert.equal(response.status, successfulTokenCount === 0 ? 502 : 409);
    assertNoStore(response);
    const body = await response.json();
    assert.equal(body.code, successfulTokenCount === 0 ? "meta_page_discovery_failed" : "facebook_pages_not_returned");
    assert.equal(Object.hasOwn(body, "missing_permissions"), false);
    assertNoPrivateProperties(body);
  }
});
