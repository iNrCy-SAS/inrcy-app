import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function readSource(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function mediaRulesSource() {
  return readSource("lib/mediaRules.ts");
}

function expectExport(source, name, expectedPattern) {
  assert.match(
    source,
    new RegExp(`export\\s+const\\s+${name}\\s*=\\s*${expectedPattern}`),
    `${name} doit rester aligné sur la règle média validée`,
  );
}

test("règles médias iNrCy centralisées", () => {
  const source = mediaRulesSource();
  expectExport(source, "INR_MEDIA_IMAGE_MAX_BYTES", "50\\s*\\*\\s*1024\\s*\\*\\s*1024");
  expectExport(source, "INR_MEDIA_IMAGE_MAX_MB_LABEL", '"50 Mo"');
  expectExport(source, "INR_MEDIA_VIDEO_SOURCE_MAX_BYTES", "75_000_000");
  expectExport(source, "INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL", '"75 Mo"');
  expectExport(
    source,
    "INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES",
    "INR_MEDIA_VIDEO_SOURCE_MAX_BYTES",
  );
  assert.doesNotMatch(source, /INR_MEDIA_VIDEO_CANONICAL_MAX_BYTES/);
  assert.doesNotMatch(source, /INR_MEDIA_VIDEO_COMPRESSION_TRIGGER_BYTES/);
  assert.doesNotMatch(source, /INR_MEDIA_VIDEO_CANONICAL_TARGET_BYTES/);
  expectExport(source, "INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT", "5");
  expectExport(source, "INR_MEDIA_PUBLICATION_IMAGE_COUNT_LABEL", '"5 images"');
  expectExport(source, "INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_BYTES", "150\\s*\\*\\s*1024\\s*\\*\\s*1024");
  expectExport(source, "INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_MB_LABEL", '"150 Mo"');
  expectExport(source, "INR_MEDIA_AGENT_MAX_MEDIA_COUNT", "1");
  expectExport(source, "INR_MEDIA_UPLOAD_BATCH_SIZE", "10");
});

test("types MIME image / vidéo autorisés", () => {
  const source = mediaRulesSource();
  for (const expected of [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/heic",
    "image/heif",
  ]) {
    assert.match(source, new RegExp(`"${expected}"`));
  }
  for (const expected of [
    "video/mp4",
    "video/x-m4v",
    "video/quicktime",
    "application/mp4",
  ]) {
    assert.match(source, new RegExp(`"${expected}"`));
  }
  assert.doesNotMatch(source, /video\/webm/);
  assert.doesNotMatch(source, /video\/avi/);
});

test("les points d’entrée média utilisent les règles partagées", () => {
  const directRuleFiles = [
    "app/dashboard/booster/publier/publishModal.shared.tsx",
    "app/dashboard/mediatheque/MediaLibraryClient.tsx",
    "app/dashboard/admin/image-bank/ImageBankAdminClient.tsx",
    "app/dashboard/agent/AgentClient.tsx",
    "app/api/media-library/upload/route.ts",
    "app/api/admin/image-bank/upload/route.ts",
    "app/api/agent/actions/route.ts",
    "app/api/agent/actions/actionPublishDraft.foundations.ts",
    "app/api/booster/upload-video/route.ts",
    "app/api/booster/video-transform/route.ts",
  ];

  for (const file of directRuleFiles) {
    const source = readSource(file);
    assert.match(source, /mediaRules/, `${file} doit importer lib/mediaRules.ts`);
  }

  const delegatedFiles = [
    "app/dashboard/booster/publier/usePublishImageController.ts",
    "app/dashboard/mails/_hooks/useMailboxPublicationMedia.ts",
    "app/dashboard/mails/_hooks/useMailboxPublicationVideo.ts",
  ];

  for (const file of delegatedFiles) {
    const source = readSource(file);
    assert.match(
      source,
      /BOOSTER_MAX_IMAGE_BYTES|BOOSTER_MAX_MEDIA_BYTES|BOOSTER_MAX_IMAGE_COUNT|BOOSTER_MAX_VIDEO_BYTES/,
      `${file} doit passer par les constantes Booster partagées`,
    );
  }
});

test("anciennes limites médias supprimées des outils de publication", () => {
  const files = [
    "app/dashboard/mails/MailboxClient.tsx",
    "app/dashboard/mails/_hooks/useMailboxPublicationMedia.ts",
    "app/dashboard/mails/_hooks/useMailboxPublicationVideo.ts",
    "app/dashboard/mediatheque/MediaLibraryClient.tsx",
    "app/dashboard/admin/image-bank/ImageBankAdminClient.tsx",
    "app/api/media-library/upload/route.ts",
    "app/api/admin/image-bank/upload/route.ts",
    "app/api/agent/actions/route.ts",
    "app/api/agent/actions/actionPublishDraft.foundations.ts",
  ];

  for (const file of files) {
    const source = readSource(file);
    assert.doesNotMatch(source, /8\s*Mo|8\s*\*\s*1024\s*\*\s*1024/, `${file} contient encore une ancienne limite image 8 Mo`);
    assert.doesNotMatch(source, /10\s*Mo|10\s*\*\s*1024\s*\*\s*1024/, `${file} contient encore une ancienne limite média 10 Mo`);
    assert.doesNotMatch(source, /80\s*Mo|80\s*\*\s*1024\s*\*\s*1024/, `${file} contient encore une ancienne limite vidéo 80 Mo`);
  }
});
