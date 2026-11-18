import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as tsSafe from "../../lib/tsSafe.ts";
import { userFacingErrorsFixture } from "../helpers/user-facing-errors-fixture.mts";

type Event = Record<string, unknown>;
type Redirect = { location: string; cookies: { set: (...args: unknown[]) => void } };
const source = ts.transpileModule(readFileSync(new URL("../../app/api/integrations/microsoft/callback/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function runtime(payload: unknown, status = 400) {
  const events: Event[] = [];
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const cleared: unknown[][] = [];
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { redirect: (url: URL) => ({ location: url.toString(), cookies: { set: (...args: unknown[]) => cleared.push(args) } }) } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture-actor" } }, error: null }) } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from() { throw new Error("Token failure must never read/write integrations"); } } },
    "@/lib/oauthCrypto": { encryptToken() { throw new Error("Failure must never encrypt/store credentials"); }, tryDecryptToken: () => null },
    "@/lib/rateLimit": { enforceRateLimit: async () => null, getClientIp: () => undefined },
    "@/lib/security": { safeInternalPath: (path: string) => path, verifyOAuthState: () => ({ ok: true, returnTo: "/dashboard?panel=mails", cookieName: "fixture-state", state: { accountId: "fixture-account" } }) },
    "@/lib/tsSafe": tsSafe,
    "@/lib/observability/oauth": { oauthCallbackEvent: (_req: Request, event: Event) => events.push(event), oauthCallbackException: () => { throw new Error("Unexpected callback exception"); } },
    "@/lib/userFacingErrors": userFacingErrorsFixture,
    "@/lib/connectionVersions": { withCurrentConnectionVersion: (_kind: string, settings: unknown) => settings },
    "@/lib/multicompte/server": { resolveOAuthBoundInrcyAccountId: async (_db: unknown, actor: string, account: string) => { assert.equal(actor, "fixture-actor"); assert.equal(account, "fixture-account"); return account; } },
  };
  const fixture = { exports: {} as { GET: (req: Request) => Promise<Redirect> } };
  new Function("require", "module", "exports", "process", "fetch", source)((name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    return modules[name];
  }, fixture, fixture.exports, { env: {
    NEXT_PUBLIC_SITE_URL: "https://app.example.test", MICROSOFT_CLIENT_ID: "fixture-client",
    MICROSOFT_CLIENT_SECRET: "PRIVATE_SECRET", MICROSOFT_REDIRECT_URI: "https://app.example.test/api/integrations/microsoft/callback",
  } }, async (url: string, init: RequestInit) => { requests.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => payload }; });
  return {
    events, requests, cleared,
    run: () => fixture.exports.GET(new Request("https://app.example.test/api/integrations/microsoft/callback?code=PRIVATE_CODE&state=PRIVATE_STATE")),
  };
}

for (const [code, providerError, expected] of [
  [7000222, "invalid_client", "microsoft_oauth_configuration_error"],
  [7000215, "invalid_client", "microsoft_oauth_configuration_error"],
  [700082, "invalid_grant", "microsoft_oauth_authorization_expired"],
  [70043, "invalid_grant", "microsoft_oauth_authorization_expired"],
] as const) {
  test(`Microsoft ${code}: records safe diagnostics and redirects with the exact public category`, async () => {
    const h = runtime({ error: providerError, error_codes: [code], error_description: `AADSTS${code}: PRIVATE_DESCRIPTION PRIVATE_SECRET PRIVATE_CODE user@example.test`, access_token: "PRIVATE_TOKEN" });
    const result = await h.run();
    const url = new URL(result.location);
    assert.equal(url.searchParams.get("error"), expected);
    assert.equal(url.searchParams.get("ok"), "0");
    assert.equal(url.searchParams.get("linked"), "microsoft");
    assert.equal(url.searchParams.get("message"), null);
    const failure = h.events.find(event => event.outcome === "failed")!;
    assert.equal(failure.error, "token_exchange_failed");
    assert.equal(failure.provider_error, providerError);
    assert.equal(failure.status_code, 400);
    assert.equal(failure.user_id, "fixture-account");
    assert.deepEqual(failure.aadsts_codes, [code]);
    assert.doesNotMatch(JSON.stringify(h.events) + result.location, /PRIVATE_|user@example|AADSTS/);
    assert.equal(h.cleared.length, 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
    assert.equal(h.requests[0].init.method, "POST");
    const form = h.requests[0].init.body as URLSearchParams;
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "PRIVATE_CODE");
    assert.equal(form.get("client_secret"), "PRIVATE_SECRET");
  });
}

test("Microsoft error_description fallback extracts only bounded numeric AADSTS codes", async () => {
  const h = runtime({ error: "invalid_client", error_description: "PRIVATE_SECRET AADSTS7000222: expired. PRIVATE_DESCRIPTION AADSTS7000222: repeated" });
  const result = await h.run();
  assert.deepEqual(h.events.at(-1)?.aadsts_codes, [7000222]);
  assert.equal(new URL(result.location).searchParams.get("error"), "microsoft_oauth_configuration_error");
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE_/);
});

test("unknown provider errors, strings and non-numeric codes cannot become log fields or public configuration claims", async () => {
  const h = runtime({ error: "PRIVATE_SECRET user@example.test", error_codes: ["7000222", -1, 1.5, 1e100, { secret: "PRIVATE_TOKEN" }], error_description: "PRIVATE_DESCRIPTION" });
  const result = await h.run();
  const failure = h.events.at(-1)!;
  assert.equal(failure.provider_error, undefined);
  assert.deepEqual(failure.aadsts_codes, []);
  assert.equal(new URL(result.location).searchParams.get("error"), "token_exchange_failed");
  assert.doesNotMatch(JSON.stringify(h.events) + result.location, /PRIVATE_|user@example/);
});

test("an invalid_grant without a known AADSTS code remains an unclassified exchange failure", async () => {
  const h = runtime({ error: "invalid_grant", error_codes: [999999], error_description: "PRIVATE_DESCRIPTION" });
  const result = await h.run();
  assert.equal(new URL(result.location).searchParams.get("error"), "token_exchange_failed");
  assert.deepEqual(h.events.at(-1)?.aadsts_codes, [999999]);
});

test("a 2xx Microsoft response without an access token still produces safe exchange diagnostics", async () => {
  for (const payload of [{}, null, "PRIVATE_TOKEN"]) {
    const h = runtime(payload, 200);
    const result = await h.run();
    assert.equal(new URL(result.location).searchParams.get("error"), "token_exchange_failed");
    assert.equal(h.events.at(-1)?.status_code, 200);
    assert.equal(h.events.at(-1)?.user_id, "fixture-account");
    assert.doesNotMatch(JSON.stringify(h.events) + result.location, /PRIVATE_/);
  }
});

test("provider 5xx status is preserved for the existing Sentry severity policy", async () => {
  const h = runtime({ error: "temporarily_unavailable", error_description: "PRIVATE_DESCRIPTION" }, 503);
  await h.run();
  assert.equal(h.events.at(-1)?.status_code, 503);
  assert.equal(h.events.at(-1)?.provider_error, "temporarily_unavailable");
});
