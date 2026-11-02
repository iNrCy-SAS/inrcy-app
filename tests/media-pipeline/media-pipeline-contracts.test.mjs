import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

function assertSource(file, pattern, message) {
  assert.match(read(file), pattern, `${message} (${file})`);
}

test("le contrat produit reste 5 images ou 1 vidéo", () => {
  const rules = read("lib/mediaRules.ts");
  assert.match(rules, /INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT\s*=\s*5/);
  assertSource(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
    /BOOSTER_MAX_VIDEO_COUNT\s*=\s*1/,
    "Le maximum vidéo doit rester à 1",
  );
});

test("les payloads publication conservent les contrats images et vidéo", () => {
  const modal = read("app/dashboard/booster/publier/publicationSubmission.ts");
  for (const pattern of [
    /mediaModeByChannel:\s*buildChannelRecord\([\s\S]{0,100}publishTargetMediaModeByChannel/,
    /imagesByChannel:\s*buildChannelRecord\([\s\S]{0,100}uploadedChannelImages/,
    /imageSettingsByChannel:\s*buildChannelRecord\([\s\S]{0,100}channelSettings/,
    /video:\s*publicationVideo/,
    /videoFormatByChannel/,
    /videoAdaptationModeByChannel/,
    /videoSettingsByChannel/,
  ]) {
    assert.match(modal, pattern);
  }
});

test("les variantes vidéo gardent une signature stable et persistable", () => {
  assertSource(
    "app/dashboard/booster/publier/usePublishVideoController.ts",
    /buildVideoTransformSignature/,
    "La préparation vidéo doit réutiliser les signatures",
  );
  assertSource(
    "app/dashboard/booster/publier/usePublishVideoController.ts",
    /transformedVariants/,
    "Les variantes doivent rester dans le payload vidéo",
  );
  assertSource(
    "app/dashboard/booster/publier/usePublishVideoController.ts",
    /storagePath/,
    "Les variantes doivent conserver leur chemin Storage",
  );
});

test("la Médiathèque fournit déjà le contrat prepare / upload direct / finalize", () => {
  assertSource(
    "app/dashboard/mediatheque/MediaLibraryClient.tsx",
    /mode:\s*"prepare"/,
    "La préparation de l'upload doit exister",
  );
  assertSource(
    "app/dashboard/mediatheque/MediaLibraryClient.tsx",
    /uploadFileToPreparedUniversalIntent\(file, intent|\.uploadToSignedUrl\(\s*prepared\.storage_path,/,
    "Le binaire doit être envoyé directement à Supabase",
  );
  assertSource(
    "app/dashboard/mediatheque/MediaLibraryClient.tsx",
    /mode:\s*"finalize"/,
    "La finalisation doit exister",
  );
});

test("le registre média existant reste privé par utilisateur", () => {
  const migration = read("ops/sql/20260625_pro_media_library.sql");
  assert.match(migration, /alter table public\.pro_media_library enable row level security/);
  assert.match(migration, /create policy "pro_media_library_select_own"/);
  assert.match(migration, /using \(auth\.uid\(\) = user_id\)/);
  assert.match(migration, /bucket_id = 'inrcy-pro-media'/);
});
