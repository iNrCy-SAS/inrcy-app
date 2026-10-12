import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isMetaAuthorizationError, isMetaRateLimitError } from "../../lib/metaGraphErrorClassification.ts";

type RecordLike = Record<string, unknown>;
type Publish = (params: RecordLike) => Promise<RecordLike>;
const source = readFileSync(new URL("../../lib/instagramPublish.ts", import.meta.url), "utf8");
const moduleRecord: { exports: RecordLike } = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const requireFromTest = createRequire(import.meta.url);
new Function("module", "exports", "require", compiled)(moduleRecord, moduleRecord.exports, (specifier: string) => {
  if (specifier === "@/lib/instagramAuthMode") return { buildInstagramGraphUrl: (path: string, authMode = "facebook_login") => `https://${authMode === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com"}/v25.0/${path}` };
  if (specifier === "@/lib/metaGraphErrorClassification") return { isMetaAuthorizationError, isMetaRateLimitError };
  return requireFromTest(specifier);
});
const publish = moduleRecord.exports.instagramPublishImagesBestEffortWithTokenFallback as Publish;

test("Instagram direct publishes all carousel phases on Instagram Graph with only its own token", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _milliseconds?: number, ...args: unknown[]) => originalTimeout(callback, 0, ...args)) as typeof setTimeout;
  const calls: URL[] = [];
  let child = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.hostname, "graph.instagram.com");
    assert.equal(url.searchParams.get("access_token"), "instagram-own-token");
    if (url.pathname.endsWith("/media")) {
      if (url.searchParams.get("media_type") === "CAROUSEL") return Response.json({ id: "300" });
      assert.equal(url.searchParams.get("is_carousel_item"), "true"); return Response.json({ id: String(100 + child++) });
    }
    if (url.pathname.endsWith("/media_publish")) { assert.equal(options?.method, "POST"); assert.equal(url.searchParams.get("creation_id"), "300"); return Response.json({ id: "400" }); }
    if (url.pathname.endsWith("/400")) return Response.json({ id: "400", children: { data: [{ id: "500" }, { id: "501" }] } });
    return Response.json({ status_code: "FINISHED" });
  };
  t.after(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; });
  const result = await publish({ igUserId: "123", accessToken: "instagram-own-token", authMode: "instagram_login", tokenCandidates: [{ source: "facebook", accessToken: "facebook-token" }], caption: "Bonjour", imageUrls: ["https://media.test/1.jpg", "https://media.test/2.jpg"] });
  assert.equal(result.ok, true); assert.equal(result.mediaId, "400"); assert.equal(child, 2); assert.ok(calls.length >= 7);
});

test("Instagram direct never sends a Facebook fallback token after authorization rejection", async (t) => {
  const originalFetch = globalThis.fetch;
  const tokens: string[] = [];
  globalThis.fetch = async (input) => { const url = new URL(String(input)); tokens.push(url.searchParams.get("access_token") || ""); return Response.json({ error: { code: 190, type: "OAuthException", message: "Invalid access token" } }, { status: 400 }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await publish({ igUserId: "123", accessToken: "instagram-own-token", authMode: "instagram_login", tokenCandidates: [{ source: "facebook", accessToken: "facebook-token" }], caption: "Bonjour", imageUrls: ["https://media.test/1.jpg"] });
  assert.equal(result.ok, false); assert.deepEqual(tokens, ["instagram-own-token"]);
});

test("Instagram historical Facebook login keeps its Graph host and authorization fallback", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _milliseconds?: number, ...args: unknown[]) => originalTimeout(callback, 0, ...args)) as typeof setTimeout;
  const tokens: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); assert.equal(url.hostname, "graph.facebook.com"); tokens.push(url.searchParams.get("access_token") || "");
    if (tokens.at(-1) === "expired-page-token") return Response.json({ error: { code: 190, message: "Invalid access token" } }, { status: 400 });
    if (url.pathname.endsWith("/media_publish")) return Response.json({ id: "400" });
    return Response.json(url.pathname.endsWith("/media") ? { id: "100" } : { status_code: "FINISHED" });
  };
  t.after(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; });
  const result = await publish({ igUserId: "123", accessToken: "expired-page-token", tokenCandidates: [{ source: "facebook_user", accessToken: "valid-facebook-token" }], caption: "Bonjour", imageUrls: ["https://media.test/1.jpg"] });
  assert.equal(result.ok, true); assert.equal(tokens[0], "expired-page-token"); assert.equal(tokens.slice(1).every((token) => token === "valid-facebook-token"), true);
});
