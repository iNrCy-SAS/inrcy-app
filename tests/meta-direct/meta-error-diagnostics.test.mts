import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Diagnostics = Readonly<{ httpStatus?: number; metaCode?: number; metaSubcode?: number }>;
type SafeError = Error & { code: string; status: number; readonly diagnostics: Diagnostics };
type Tokens = {
  MetaDirectApiError: new (code: string, message: string, status?: number, diagnostics?: unknown) => SafeError;
  fetchMetaDirectJson: (url: string | URL, init?: RequestInit) => Promise<Record<string, unknown>>;
};
function load<T>(file: string, dependencies: Record<string, unknown> = {}): T {
  const compiled = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, (id: string) => {
    if (id === "server-only") return {};
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  });
  return exports as T;
}
const tokens = load<Tokens>("lib/metaDirectTokens.ts", {
  "@/lib/tsSafe": load("lib/tsSafe.ts"),
  "@/lib/oauthCrypto": {},
  "@/lib/instagramAuthMode": {},
});
const SECRET = "SYNTHETIC_META_DIAGNOSTIC_SECRET";
const USER_INFO = "PRIVATE_META_PERSON@example.test";
const providerUrl = `https://graph.threads.com/access_token?client_secret=${SECRET}&access_token=${SECRET}`;

async function withFetch(fake: typeof fetch, body: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = fake;
  try { await body(); } finally { globalThis.fetch = previous; }
}
function assertSafe(error: SafeError) {
  const serialized = JSON.stringify({ error, message: error.message, stack: error.stack });
  for (const forbidden of [SECRET, USER_INFO, "graph.threads.com", "Bearer", "PROVIDER_MESSAGE"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.deepEqual(Object.keys(error).sort(), ["code", "diagnostics", "name", "status"]);
  assert.ok(Object.isFrozen(error.diagnostics));
  for (const [key, value] of Object.entries(error.diagnostics)) {
    assert.ok(["httpStatus", "metaCode", "metaSubcode"].includes(key));
    assert.equal(typeof value, "number");
    assert.ok(Number.isFinite(value));
  }
}
async function rejected(fake: typeof fetch): Promise<SafeError> {
  let captured: SafeError | undefined;
  await withFetch(fake, async () => {
    await assert.rejects(tokens.fetchMetaDirectJson(providerUrl, {
      method: "POST", headers: { Authorization: `Bearer ${SECRET}` },
      body: new URLSearchParams({ client_secret: SECRET }),
    }), (error: unknown) => {
      assert.ok(error instanceof tokens.MetaDirectApiError);
      captured = error;
      assertSafe(error);
      return true;
    });
  });
  assert.ok(captured);
  return captured;
}

test("Graph errors expose only HTTP and finite numeric Meta codes, never provider messages or user information", async () => {
  const error = await rejected(async () => Response.json({
    error: { code: 190, error_subcode: 463, message: `PROVIDER_MESSAGE ${SECRET} ${USER_INFO} ${providerUrl}`, type: "OAuthException", fbtrace_id: SECRET },
    access_token: SECRET, user: { email: USER_INFO },
  }, { status: 401, headers: { "x-provider-token": SECRET } }));
  assert.equal(error.code, "meta_direct_reconnect_required");
  assert.equal(error.status, 401);
  assert.deepEqual(error.diagnostics, { httpStatus: 401, metaCode: 190, metaSubcode: 463 });
});

test("Diagnostics retain the actual provider HTTP status separately from application classification and preserve numeric zero", async () => {
  const error = await rejected(async () => Response.json({ error: { code: 10, error_subcode: 0, message: SECRET } }));
  assert.equal(error.status, 400);
  assert.deepEqual(error.diagnostics, { httpStatus: 200, metaCode: 10, metaSubcode: 0 });
  const oauth = await rejected(async () => Response.json({ error_type: "OAuthException", code: 400, error_subcode: 71, error_message: `${SECRET} ${USER_INFO}` }, { status: 400 }));
  assert.deepEqual(oauth.diagnostics, { httpStatus: 400, metaCode: 400, metaSubcode: 71 });
});

test("Error diagnostics reject strings, nonfinite numbers and arbitrary metadata even at the constructor boundary", async () => {
  for (const value of ["190", "", null, true, NaN, Infinity, -Infinity, { token: SECRET }]) {
    const error = new tokens.MetaDirectApiError("safe_code", "Message contrôlé.", 400, {
      httpStatus: 400, metaCode: value, metaSubcode: value,
      body: SECRET, message: SECRET, url: providerUrl, headers: { Authorization: SECRET }, user: USER_INFO,
    });
    assert.deepEqual(error.diagnostics, { httpStatus: 400 });
    assertSafe(error);
  }
  const stringCode = await rejected(async () => Response.json({ error: { code: "190", error_subcode: SECRET, message: USER_INFO } }, { status: 400 }));
  assert.equal(stringCode.code, "meta_direct_reconnect_required", "existing authentication classification is preserved");
  assert.deepEqual(stringCode.diagnostics, { httpStatus: 400 });
});

test("Invalid JSON records only HTTP status and network errors retain no response, URL or original cause", async () => {
  const invalid = await rejected(async () => new Response(`${SECRET} ${USER_INFO} ${providerUrl}`, { status: 503 }));
  assert.equal(invalid.code, "meta_response_invalid");
  assert.equal(invalid.status, 502);
  assert.deepEqual(invalid.diagnostics, { httpStatus: 503 });
  const network = await rejected(async () => { throw Object.assign(new Error(`${SECRET} ${USER_INFO} ${providerUrl}`), { response: { body: SECRET }, request: { url: providerUrl } }); });
  assert.equal(network.code, "meta_request_unavailable");
  assert.equal(network.status, 502);
  assert.deepEqual(network.diagnostics, {});
});

test("Successful token responses remain available to the caller without an error or diagnostic side channel", async () => {
  const body = { access_token: SECRET, username: USER_INFO, expires_in: 5184000 };
  await withFetch(async () => Response.json(body), async () => {
    assert.deepEqual(await tokens.fetchMetaDirectJson(providerUrl), body);
  });
});
