import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);

async function read(relativePath: string) {
  return await readFile(new URL(relativePath, ROOT), "utf8");
}

test("server-probed GIF and AVIF stay eligible for the original workspace source", async () => {
  const source = await read("lib/mediaWorkspaceConsumption.ts");
  const directTypes = source.slice(
    source.indexOf("const DIRECT_PUBLICATION_IMAGE_MIME_TYPES"),
    source.indexOf("function sourceMetadataForMedia"),
  );
  const directProof = source.slice(
    source.indexOf("function canUseDirectWorkspaceImageSource"),
    source.indexOf("function directVideoProofForMedia"),
  );

  assert.match(directTypes, /"image\/gif"/);
  assert.match(directTypes, /"image\/avif"/);
  assert.match(directProof, /metadata\.probeProvenance !== "server_sharp"/);
  assert.match(directProof, /mimeType === "image\/gif" && serverFormat === "gif"/);
  assert.match(directProof, /mimeType === "image\/avif" && serverFormat === "avif"/);
  assert.match(directProof, /positiveMetadataNumber\(metadata\.width\)/);
  assert.match(directProof, /positiveMetadataNumber\(metadata\.height\)/);
});

test("internal web channels preserve original GIF and AVIF while external providers stay conservative", async () => {
  const source = await read("lib/boosterImageServerPreparation.ts");
  const policy = source.slice(
    source.indexOf("const ORIGINAL_IMAGE_MIME_TYPES_BY_CHANNEL"),
    source.indexOf("function normalizedImageMime"),
  );

  for (const channel of ["site_web", "inr_search"]) {
    const start = policy.indexOf(`${channel}: new Set([`);
    const end = policy.indexOf("]),", start);
    assert.ok(start >= 0 && end > start, `politique introuvable pour ${channel}`);
    const accepted = policy.slice(start, end);
    assert.match(accepted, /"image\/gif"/);
    assert.match(accepted, /"image\/avif"/);
  }

  for (const channel of [
    "gmb",
    "facebook",
    "instagram",
    "linkedin",
    "tiktok",
    "youtube_shorts",
    "pinterest",
  ]) {
    const start = policy.indexOf(`${channel}: new Set(`);
    const lineEnd = policy.indexOf("\n", start);
    assert.ok(start >= 0 && lineEnd > start, `politique introuvable pour ${channel}`);
    const accepted = policy.slice(start, lineEnd);
    assert.doesNotMatch(accepted, /"image\/(?:gif|avif)"/);
  }
});
