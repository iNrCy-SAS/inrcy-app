import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as metaGraph from "../../lib/metaGraphApi.ts";
import type * as Auth from "../../lib/instagramAuthMode.ts";
import type * as Deletion from "../../lib/inrsend/instagramPublicationDeletion.ts";

const authRecord = { exports: {} as typeof Auth };
const authCode = ts.transpileModule(readFileSync(new URL("../../lib/instagramAuthMode.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("module", "exports", "require", authCode)(authRecord, authRecord.exports, (name: string) => { assert.equal(name, "@/lib/metaGraphApi"); return metaGraph; });
const auth = authRecord.exports;

type Reply = { status?: number; body: unknown };
function runtime(replies: Reply[] = []) {
  const calls: Array<{ url: URL; method: string }> = [];
  const logs: Array<{ level: string; event: string; context: unknown }> = [];
  const code = ts.transpileModule(readFileSync(new URL("../../lib/inrsend/instagramPublicationDeletion.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} as typeof Deletion };
  new Function("module", "exports", "require", "fetch", code)(record, record.exports, (name: string) => {
    if (name === "crypto") return { createHash };
    if (name === "@/lib/instagramAuthMode") return auth;
    if (name === "@/lib/oauthCrypto") return { tryDecryptToken: (value: string) => value.startsWith("enc:") ? value.slice(4) : value };
    if (name === "@/lib/observability/logger") return { log: Object.fromEntries(["info", "warn"].map((level) => [level, (event: string, context: unknown) => logs.push({ level, event, context })])) };
    throw new Error(`Unexpected deletion dependency: ${name}`);
  }, async (url: string, options: RequestInit) => {
    assert.equal(options.cache, "no-store");
    calls.push({ url: new URL(url), method: String(options.method) });
    const reply = replies.shift(); assert.ok(reply, "No unplanned provider request is permitted");
    return Response.json(reply.body, { status: reply.status || 200 });
  });
  return { ...record.exports, calls, logs };
}
const direct = { access_token_enc: "enc:private-instagram", meta: { auth_mode: "instagram_login" } };
const facebook = { access_token_enc: "enc:private-facebook", meta: { auth_mode: "facebook_login" } };

test("direct login uses only its Instagram token while Facebook login deduplicates candidates in their original order", () => {
  const h = runtime();
  const directTokens = h.buildInstagramDeleteTokenCandidates([{ sourceLabel: "facebook", row: facebook }, { sourceLabel: "instagram", row: direct }]);
  assert.equal(directTokens.length, 1);
  assert.equal(directTokens[0].source, "instagram.access_token_enc");
  assert.equal(directTokens[0].token, "private-instagram");
  assert.match(directTokens[0].preview, /^tok_[a-f0-9]{10}$/);
  assert.equal(directTokens[0].preview.includes("private"), false);
  const candidates = h.buildInstagramDeleteTokenCandidates([
    { sourceLabel: "instagram", row: { ...facebook, meta: { standard_user_access_token_enc: "enc:standard", business_user_access_token_enc: "enc:private-facebook", user_access_token: "user" } } },
    { sourceLabel: "facebook", row: { access_token_enc: "enc:other", meta: { user_access_token: "user" } } },
  ]);
  assert.deepEqual(candidates.map(({ token }) => token), ["private-facebook", "standard", "user", "other"]);
});

test("a carousel child resolves to its persisted parent before both verification and deletion", async () => {
  const h = runtime([{ body: { id: "parent", media_type: "CAROUSEL_ALBUM" } }, { body: { success: true } }]);
  const result = await h.deleteInstagramMediaWithFallback("child", { igRow: direct, channelResult: { instagram_media_type: "CAROUSEL_ALBUM", instagram_parent_media_id: "parent", instagram_child_media_ids: ["child"] } });
  assert.equal(result.ok, true);
  assert.equal(result.external_id, "child");
  assert.equal(result.delete_target_id, "parent");
  assert.equal(result.carousel_parent_protected, true);
  assert.equal(result.verified, true);
  assert.deepEqual(h.calls.map(({ method }) => method), ["GET", "DELETE"]);
  for (const call of h.calls) {
    assert.equal(call.url.pathname.endsWith("/parent"), true);
    assert.equal(call.url.hostname, "graph.instagram.com");
    assert.equal(call.url.searchParams.get("access_token"), "private-instagram");
  }
  assert.equal(JSON.stringify(h.logs).includes("private-instagram"), false);
});

test("failed verification never deletes with that token and the next verified candidate can complete the request", async () => {
  const h = runtime([{ status: 403, body: { error: { message: "Denied", code: 10 } } }, { body: { id: "media" } }, { body: { success: true } }]);
  const result = await h.deleteInstagramMediaWithFallback("media", { igRow: facebook, fbRow: { access_token_enc: "enc:second" } });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.map(({ method }) => method), ["GET", "GET", "DELETE"]);
  assert.deepEqual(h.calls.map(({ url }) => url.searchParams.get("access_token")), ["private-facebook", "second", "second"]);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].verified, false);
  assert.equal(result.attempts[1].success, true);
});

test("unsupported remote deletion returns its diagnostic result and stays informational", async () => {
  const h = runtime([{ body: { id: "media" } }, { status: 403, body: { error: { message: "Insufficient permission", code: 10 } } }]);
  const result = await h.deleteInstagramMediaWithFallback("media", { igRow: direct });
  assert.equal(result.ok, false);
  assert.equal(result.verified, true);
  assert.equal(result.error, "Insufficient permission");
  assert.equal(h.logs.find(({ event }) => event === "instagram_delete_remote_unsupported")?.level, "info");
  assert.equal(h.logs.some(({ event }) => event === "instagram_delete_attempt_failed"), false);
});

test("unexpected provider failures throw with their attempts unless local fallback was explicitly allowed", async () => {
  for (const allowLocalFallback of [false, true]) {
    const h = runtime([{ body: { id: "media" } }, { status: 500, body: { error: { message: "Provider failure", code: 1 } } }]);
    const task = h.deleteInstagramMediaWithFallback("media", { igRow: direct, allowLocalFallback });
    if (allowLocalFallback) assert.equal((await task).ok, false);
    else await assert.rejects(task, (error: Error & { instagramDeleteResult?: Deletion.InstagramDeleteResult }) => {
      assert.equal(error.message, "Provider failure");
      assert.equal(error.instagramDeleteResult?.attempts.length, 1);
      assert.equal(error.instagramDeleteResult?.verified, true);
      return true;
    });
    assert.equal(h.logs.find(({ event }) => event === "instagram_delete_attempt_failed")?.level, "warn");
  }
});

test("missing IDs or credentials perform no provider calls and retain their existing fallback contract", async () => {
  const h = runtime();
  assert.equal((await h.deleteInstagramMediaWithFallback("")).ok, true);
  await assert.rejects(h.deleteInstagramMediaWithFallback("media"), /correctement relié/);
  assert.equal((await h.deleteInstagramMediaWithFallback("media", { allowLocalFallback: true })).ok, false);
  assert.deepEqual(h.calls, []);
});
