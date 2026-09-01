import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("private generated media requires the active account in addition to its signed link", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/media-library/items/[id]/content/route.ts"),
    "utf8",
  );

  assert.match(route, /requireUser\(\)/);
  assert.match(route, /if \(errorResponse\) return errorResponse/);
  assert.match(route, /\.eq\("user_id", activeUserId\)/);
  assert.match(route, /verifyMediaLibraryContentToken\(id, token\)/);
  assert.match(route, /createSafeStorageSignedUrl\(bucket, storagePath, 120\)/);
});

test("temporary AI drafts never leak into or mutate through the generic media library", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/media-library/items/route.ts"),
    "utf8",
  );

  assert.match(
    route,
    /const AI_MEDIA_GENERATION_DRAFT_SOURCE = "ai_media_generation_draft"/,
  );
  assert.match(
    route,
    /\.eq\("user_id", activeUserId\)[\s\S]*?\.neq\("source", AI_MEDIA_GENERATION_DRAFT_SOURCE\)[\s\S]*?\.order\("created_at"/,
  );

  const patchStart = route.indexOf("export async function PATCH");
  const deleteStart = route.indexOf("export async function DELETE");
  assert.ok(patchStart >= 0 && deleteStart > patchStart);
  const patch = route.slice(patchStart, deleteStart);
  const deletion = route.slice(deleteStart);

  assert.match(patch, /existing\.data\.source === AI_MEDIA_GENERATION_DRAFT_SOURCE/);
  assert.match(patch, /\.neq\("source", AI_MEDIA_GENERATION_DRAFT_SOURCE\)/);
  assert.match(deletion, /\.select\("id,bucket_name,storage_path,source"\)/);
  assert.match(deletion, /row\.source === AI_MEDIA_GENERATION_DRAFT_SOURCE/);
  assert.match(route, /doit être validé ou abandonné depuis l’outil de génération/);
});
