import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function runtime(responses: Array<Response | Error>) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const exports: { deleteFacebookPost?: (id: string, token: string, pageId: string) => Promise<void> } = {};
  const source = readFileSync(new URL("../../lib/facebookPostActions.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", "fetch", code)(exports, (id: string) => {
    assert.equal(id, "@/lib/metaGraphApi");
    return { buildMetaGraphUrl: (path: string) => `https://graph.facebook.com/v25.0/${path}` };
  }, async (url: string, init: RequestInit) => {
    requests.push({ url: new URL(url), init });
    const response = responses.shift();
    assert.ok(response, "unexpected provider call");
    if (response instanceof Error) throw response;
    return response;
  });
  return { requests, remove: exports.deleteFacebookPost! };
}

const deprecated = () => Response.json({ error: { code: 12, message: "(#12) singular statuses API is deprecated for versions v2.4 and higher" } }, { status: 400 });

for (const id of ["987654", "123456_987654"]) test(`deletion preserves a supported original ID: ${id}`, async () => {
  const h = runtime([Response.json({ success: true })]);
  await h.remove(id, "fixture-page-token", "123456");
  assert.deepEqual(h.requests.map(r => r.url.pathname), [`/v25.0/${id}`]);
  assert.equal(h.requests[0].init.method, "DELETE");
  assert.equal(new Headers(h.requests[0].init.headers).get("Authorization"), "Bearer fixture-page-token");
  assert.equal(h.requests[0].url.searchParams.has("access_token"), false);
});

test("Meta singular-status rejection is retried once with the stored Page namespace", async () => {
  const h = runtime([deprecated(), Response.json(true)]);
  await h.remove("987654", "fixture-page-token", "123456");
  assert.deepEqual(h.requests.map(r => r.url.pathname), ["/v25.0/987654", "/v25.0/123456_987654"]);
});

for (const pageId of ["", "other/page"]) test(`an unverified Page cannot be used for a fallback: ${pageId}`, async () => {
  const h = runtime([deprecated()]);
  await assert.rejects(h.remove("987654", "fixture", pageId), { providerCode: 12 });
  assert.equal(h.requests.length, 1);
});

test("a namespaced post is never rewritten onto another Page", async () => {
  const h = runtime([deprecated()]);
  await assert.rejects(h.remove("111_987654", "fixture", "123456"));
  assert.equal(h.requests.length, 1);
});

for (const code of [10, 100, 190, 4]) test(`Facebook error ${code} is preserved without blind retries`, async () => {
  const h = runtime([Response.json({ error: { code, message: "Provider refused the request" } }, { status: 400 })]);
  await assert.rejects(h.remove("987654", "fixture", "123456"), { providerCode: code, httpStatus: 400 });
  assert.equal(h.requests.length, 1);
});

for (const response of [Response.json({}), Response.json({ success: false }), new Response("invalid-json")]) test("an ambiguous success never marks the deletion complete or retries", async () => {
  const h = runtime([response]);
  await assert.rejects(h.remove("987654", "fixture", "123456"), /non confirmée/);
  assert.equal(h.requests.length, 1);
});

test("a transport failure cannot trigger a second destructive request", async () => {
  const h = runtime([new Error("connection closed after request")]);
  await assert.rejects(h.remove("987654", "fixture", "123456"), /connection closed/);
  assert.equal(h.requests.length, 1);
});

test("failure of the Page-qualified retry is surfaced and never loops", async () => {
  const h = runtime([deprecated(), deprecated()]);
  await assert.rejects(h.remove("987654", "fixture", "123456"), { providerCode: 12 });
  assert.equal(h.requests.length, 2);
});
