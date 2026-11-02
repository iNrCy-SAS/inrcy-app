import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { BOOSTER_VIDEO_PREPARATION_KEYS } from "../../lib/boosterMediaPipelineMissions.ts";
import {
  GOOGLE_BUSINESS_VIDEO_MAX_BYTES,
  GOOGLE_BUSINESS_VIDEO_MAX_DURATION_SECONDS,
  GOOGLE_BUSINESS_VIDEO_MIN_SHORT_EDGE,
} from "../../lib/googleBusinessMediaPolicy.ts";
import {
  INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  isInrMediaVideoFile,
} from "../../lib/mediaRules.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("le contrat Booster accepte exactement 75 Mo, jamais un octet de plus", () => {
  assert.equal(INR_MEDIA_VIDEO_SOURCE_MAX_BYTES, 75_000_000);
  assert.equal(INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES, 75_000_000);
  assert.equal(75_000_000 <= INR_MEDIA_VIDEO_SOURCE_MAX_BYTES, true);
  assert.equal(75_000_001 <= INR_MEDIA_VIDEO_SOURCE_MAX_BYTES, false);
});

test("MP4, M4V et MOV sont admis, les conteneurs nécessitant une conversion restent hors Booster", () => {
  assert.equal(isInrMediaVideoFile({ name: "social.mp4", type: "video/mp4" }), true);
  assert.equal(isInrMediaVideoFile({ name: "export.m4v", type: "video/x-m4v" }), true);
  assert.equal(isInrMediaVideoFile({ name: "iphone.mov", type: "video/quicktime" }), true);
  assert.equal(isInrMediaVideoFile({ name: "source.webm", type: "video/webm" }), false);
  assert.equal(isInrMediaVideoFile({ name: "source.mkv", type: "video/x-matroska" }), false);
});

test("le worker Booster garde un fallback canonique borné à 75 Mo", () => {
  assert.deepEqual(BOOSTER_VIDEO_PREPARATION_KEYS.publication_preparation, [
    "canonical",
    "thumbnail",
  ]);
  assert.deepEqual(BOOSTER_VIDEO_PREPARATION_KEYS.ai_preparation, [
    "thumbnail",
    "frame_01",
    "frame_02",
    "frame_03",
    "audio_track",
  ]);
  const normalizer = read("lib/mediaVideoNormalizer.ts");
  assert.match(normalizer, /prepareCanonical/);
  assert.match(normalizer, /libx264/);
  assert.match(normalizer, /VIDEO_CANONICAL_MAX_BYTES/);
});

test("Google Business partage les 75 Mo et conserve seulement ses règles métier", () => {
  assert.equal(GOOGLE_BUSINESS_VIDEO_MAX_BYTES, 75_000_000);
  assert.equal(GOOGLE_BUSINESS_VIDEO_MAX_DURATION_SECONDS, 30);
  assert.equal(GOOGLE_BUSINESS_VIDEO_MIN_SHORT_EDGE, 720);
  const policy = read("lib/googleBusinessMediaPolicy.ts");
  assert.doesNotMatch(policy, /VIDEO_TARGET_MAX_BYTES|size_requires_compression/);
});

test("les progressions parlent de préparation et jamais de compression", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  assert.match(submission, /Préparation des médias/);
  assert.doesNotMatch([modal, submission].join("\n"), /Compression des médias/);
});

test("la publication durable et iNrSend restent auto-récupérants", () => {
  const proxy = read("proxy.ts");
  const cron = read("app/api/cron/booster-publications/route.ts");
  const mailbox = read("app/dashboard/mails/_lib/mailboxHistoryPreload.ts");
  assert.match(proxy, /isAuthorizedInternalPublishWorker/);
  assert.match(proxy, /if \(isAuthorizedInternalPublishWorker\(req, pathname\)\)/);
  assert.match(cron, /if \(!response\.ok\)[\s\S]*throw new Error/);
  assert.match(mailbox, /MAILBOX_HISTORY_ACTIVE_REFRESH_MS = 10_000/);
});
