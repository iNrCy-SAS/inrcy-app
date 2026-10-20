import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const TOKEN = "a".repeat(64);
type RequestFixture = { headers: Headers; nextUrl: URL; text: () => Promise<string> };

function fixture() {
  const calls: { name: string; args: unknown }[] = [];
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  let rpcResult: { data: Record<string, unknown> | null; error: unknown } = { data: { valid: true, expires_at: expiresAt, email: "must-not-leak@example.com", token_hash: TOKEN }, error: null };
  let limited: Response | null = null;
  const moduleValue = { exports: {} as { POST: (req: RequestFixture) => Promise<Response> } };
  const source = readFileSync(new URL("../../app/api/auth/password-link-status/route.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module: moduleValue, exports: moduleValue.exports, AbortSignal,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: Response.json } };
      if (name === "@/lib/supabaseAdmin") return { supabaseAdmin: { rpc: (rpcName: string, args: unknown) => {
        calls.push({ name: rpcName, args });
        return { abortSignal: (signal: AbortSignal) => { assert.ok(signal); return Promise.resolve(rpcResult); } };
      } } };
      if (name === "@/lib/rateLimit") return { getClientIp: () => "test-ip", enforceRateLimit: async (config: { failClosed: boolean }) => { assert.equal(config.failClosed, true); return limited; } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const post = (body: unknown = { mode: "invite", token_hash: TOKEN, email: " INVITEE@EXAMPLE.COM " }, origin = "https://app.example") => moduleValue.exports.POST({
    headers: new Headers({ origin }), nextUrl: new URL("https://app.example/api/auth/password-link-status"),
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  });
  return { post, calls, expiresAt, backend: (next: typeof rpcResult) => { rpcResult = next; }, limit: (response: Response) => { limited = response; } };
}

test("anonymous preflight only calls the read-only RPC and strips all identity/token fields", async () => {
  const route = fixture();
  const response = await route.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { valid: true, expires_at: route.expiresAt });
  assert.deepEqual(JSON.parse(JSON.stringify(route.calls)), [{ name: "inrcy_password_link_status", args: { p_token_hash: TOKEN, p_mode: "invite", p_email: "invitee@example.com" } }]);
});

test("used/expired proofs have the same generic response without exposing an account", async () => {
  const route = fixture();
  route.backend({ data: { valid: false, email: "must-not-leak@example.com" }, error: null });
  assert.deepEqual(await (await route.post()).json(), { valid: false });
});

test("unavailable database or absent migration offers retry and never reports an expired link", async () => {
  const route = fixture();
  for (const next of [{ data: null, error: { code: "PGRST202" } }, { data: {}, error: null }]) {
    route.backend(next);
    const response = await route.post();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "link_check_unavailable", retryable: true });
  }
});

test("wrong origins and malformed proofs cannot reach privileged Auth lookup", async () => {
  const route = fixture();
  assert.equal((await route.post(undefined, "https://untrusted.example")).status, 403);
  for (const body of [null, [], "invalid-json", { mode: "signup", token_hash: TOKEN }, { mode: "invite", token_hash: "too-short" }, { mode: "invite", token_hash: TOKEN, email: "invalid-address" }]) {
    assert.deepEqual(await (await route.post(body)).json(), { valid: false });
  }
  assert.equal(route.calls.length, 0);
});

test("rate limiting fails closed, keeps no-store and makes no privileged query", async () => {
  const route = fixture();
  route.limit(Response.json({ code: "rate_limit_burst" }, { status: 429, headers: { "Retry-After": "60" } }));
  const response = await route.post();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(route.calls.length, 0);
});
