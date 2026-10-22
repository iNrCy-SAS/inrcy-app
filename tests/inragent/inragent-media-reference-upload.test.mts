import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import sharp from "sharp";
import ts from "typescript";
import * as references from "../../lib/inrAgentMediaReferences.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { prepareAiMediaIdentityReferences } from "../../lib/aiMediaIdentityReferences.ts";

const accountA = "aaaaaaaa-1111-4111-8111-111111111111";
const accountB = "bbbbbbbb-1111-4111-8111-111111111111";
const compiled = ts.transpileModule(readFileSync(new URL("../../app/api/agent/media-references/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function harness() {
  let accountId = accountA;
  let authenticated = true;
  const stored = new Map<string, Buffer>();
  const dependencies: Record<string, unknown> = {
    "node:crypto": crypto, sharp, "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: accountId,
      errorResponse: authenticated ? null : Response.json({}, { status: 401 }) }) },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: (bucket: string) => {
      assert.equal(bucket, "inrcy-pro-media"); return {
        upload: async (path: string, data: Buffer, options: { upsert: boolean }) => { assert.equal(options.upsert, false); stored.set(path, data); return { error: null }; },
        download: async (path: string) => ({ data: stored.has(path) ? new Blob([Uint8Array.from(stored.get(path)!)]) : null, error: null }),
      };
    } } } },
    "@/lib/aiMediaIdentityReferences": { prepareAiMediaIdentityReferences },
    "@/lib/aiMediaGenerationContracts": contracts, "@/lib/inrAgentMediaReferences": references,
  };
  const result: { POST?: (request: Request) => Promise<Response>; GET?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", compiled)((id: string) => { assert.ok(id in dependencies, id); return dependencies[id]; }, result);
  return { post: (body: unknown) => result.POST!(new Request("https://app.test/api/agent/media-references", {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })),
    get: (id: string) => result.GET!(new Request("https://app.test/api/agent/media-references?id=" + encodeURIComponent(id))),
    stored, setAccount: (value: string) => { accountId = value; }, signOut: () => { authenticated = false; } };
}
test("une référence est réellement normalisée, sauvegardée en privé puis relue sans URL publique", async () => {
  const h = harness();
  const image = await sharp({ create: { width: 120, height: 90, channels: 3, background: "#54b5c4" } }).png().toBuffer();
  const response = await h.post({ accountId: accountA, image: { mimeType: "image/png", data: image.toString("base64"), name: "Décor.png" } });
  assert.equal(response.status, 200);
  const payload = await response.json(); assert.ok(references.INR_AGENT_REFERENCE_ID.test(payload.id));
  assert.equal(payload.signedUrl, undefined); assert.equal(payload.publicUrl, undefined);
  const path = references.inrAgentReferenceStoragePath(accountA, payload.id);
  assert.equal((await sharp(h.stored.get(path)!).metadata()).format, "jpeg");
  const preview = await h.get(payload.id);
  assert.equal(preview.status, 200); assert.match(preview.headers.get("Cache-Control")!, /private.*no-store/);
  assert.equal(preview.headers.get("Content-Type"), "image/jpeg");
  h.setAccount(accountB); assert.equal((await h.get(payload.id)).status, 404);
});
test("un compte différent et les faux fichiers ne peuvent pas être enregistrés", async () => {
  const h = harness();
  assert.equal((await h.post({ accountId: accountB, image: {} })).status, 409);
  assert.equal((await h.post({ accountId: accountA, image: { mimeType: "image/jpeg", data: Buffer.alloc(80, 1).toString("base64") } })).status, 400);
  assert.equal((await h.post({ accountId: accountA, image: { mimeType: "image/svg+xml", data: "x".repeat(80) } })).status, 400);
  assert.equal((await h.get("../../other-account/photo")).status, 404);
  assert.equal(h.stored.size, 0);
});
test("l'authentification et la limite de taille sont vérifiées avant le stockage", async () => {
  const h = harness();
  assert.equal((await h.post({ accountId: accountA, image: { mimeType: "image/jpeg", data: "x".repeat(contracts.AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS + 2500) } })).status, 413);
  h.signOut();
  assert.equal((await h.get("aaaaaaaa-2222-4222-8222-222222222222")).status, 401);
  assert.equal((await h.post({})).status, 401); assert.equal(h.stored.size, 0);
});
