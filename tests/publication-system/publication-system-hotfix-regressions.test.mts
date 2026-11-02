import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mergeBoosterChannelImageSelection } from "../../lib/boosterChannelImageSelection.ts";
import { buildBoosterPublicationDispatchPlan } from "../../lib/boosterPublicationDispatchPlan.ts";
import {
  classifyBoosterPublicationResult,
  isPendingPublicationResult,
  mergePreflightFailuresIntoPublicationSummary,
} from "../../lib/boosterPublicationOutcome.ts";
import {
  BoosterPublishError,
  postBoosterPublication,
} from "../../lib/boosterPublishClient.ts";
import {
  buildVideoTransformPlan,
  getVideoPublicationProfileForChannel,
} from "../../lib/boosterVideoTransforms.ts";
import {
  getVideoPublicationPolicy,
  PINTEREST_VIDEO_TOO_LONG_MESSAGE,
  validateVideoPublicationForChannel,
} from "../../lib/videoPublicationPolicy.ts";
import { getBoosterOriginalPublicationExtension } from "../../lib/boosterImageOutputPolicy.ts";
import { getProviderCreateFailureSafety } from "../../lib/providerMediaFallbackPolicy.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("un statut générique iNrSearch publié ne devient jamais un faux pending TikTok", () => {
  const internalResult = { ok: true, internal: true, status: "published" };
  assert.equal(isPendingPublicationResult(internalResult), false);
  assert.equal(classifyBoosterPublicationResult(internalResult).status, "published");

  const tiktokResult = { ok: true, tiktok_status: "PROCESSING_UPLOAD" };
  assert.equal(isPendingPublicationResult(tiktokResult), true);
  assert.equal(classifyBoosterPublicationResult(tiktokResult).status, "processing");
});

test("TikTok garde le plafond technique de 10 minutes avant la limite dynamique du compte", () => {
  assert.equal(getVideoPublicationPolicy("tiktok").maxDurationSeconds, 600);
  const validation = validateVideoPublicationForChannel({
    channel: "tiktok",
    name: "video-10m36.mp4",
    type: "video/mp4",
    storagePath: "video-10m36.mp4",
    sizeBytes: 50 * 1024 * 1024,
    durationSeconds: 636,
    width: 1920,
    height: 1080,
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reason, "video_duration_too_long");
    assert.equal(
      validation.message,
      "Cette vidéo est trop longue pour TikTok. Choisissez une vidéo de 10 minutes maximum.",
    );
  }
});

test("Pinterest accepte 10 min 36 en épingle standard et bloque seulement au-delà de 15 minutes", () => {
  assert.equal(getVideoPublicationPolicy("pinterest").maxDurationSeconds, 900);
  const accepted = validateVideoPublicationForChannel({
    channel: "pinterest",
    name: "video-10m36.mp4",
    type: "video/mp4",
    storagePath: "video-10m36.mp4",
    sizeBytes: 50 * 1024 * 1024,
    durationSeconds: 636,
    width: 1920,
    height: 1080,
  });
  assert.equal(accepted.ok, true);

  const validation = validateVideoPublicationForChannel({
    channel: "pinterest",
    name: "video-15m01.mp4",
    type: "video/mp4",
    storagePath: "video-15m01.mp4",
    sizeBytes: 50 * 1024 * 1024,
    durationSeconds: 901,
    width: 1920,
    height: 1080,
  });
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.reason, "video_duration_too_long");
  assert.match(validation.message, /15 min 1 s/);
  assert.match(validation.message, /Règle Pinterest/i);
  assert.match(validation.message, /entre 4 secondes et 15 minutes/i);
});

test("un préflight TikTok invalide terminalise TikTok mais garde Site et iNrSearch dispatchables", () => {
  const channels = ["site_web", "inr_search", "tiktok"] as const;
  const plan = buildBoosterPublicationDispatchPlan(channels, {
    tiktok: {
      ok: false,
      code: "video_duration_too_long",
      error: "La vidéo dépasse la limite de ce compte TikTok.",
      retryable: false,
    },
  });

  assert.deepEqual(plan.dispatchableChannels, ["site_web", "inr_search"]);
  assert.deepEqual(plan.failedChannels, ["tiktok"]);
  assert.deepEqual(
    plan.entries.map(({ channel, status }) => ({ channel, status })),
    [
      { channel: "site_web", status: "queued" },
      { channel: "inr_search", status: "queued" },
      { channel: "tiktok", status: "failed" },
    ],
  );
});

test("un préflight Pinterest invalide garde Site, iNrSearch et TikTok dispatchables", () => {
  const channels = ["site_web", "inr_search", "tiktok", "pinterest"] as const;
  const plan = buildBoosterPublicationDispatchPlan(channels, {
    pinterest: {
      ok: false,
      code: "video_duration_too_long",
      error: PINTEREST_VIDEO_TOO_LONG_MESSAGE,
      retryable: false,
    },
  });

  assert.deepEqual(plan.dispatchableChannels, [
    "site_web",
    "inr_search",
    "tiktok",
  ]);
  assert.deepEqual(plan.failedChannels, ["pinterest"]);
});

test("le bilan transforme le blocage Pinterest avant envoi en échec explicite", () => {
  const summary = mergePreflightFailuresIntoPublicationSummary(
    {
      total: 3,
      successCount: 3,
      failureCount: 0,
      allSucceeded: true,
      allFailed: false,
      entries: [
        { channel: "site_web", label: "Site web", ok: true, status: "published" },
        { channel: "inr_search", label: "iNr'Search", ok: true, status: "published" },
        { channel: "tiktok", label: "TikTok", ok: true, status: "published" },
      ],
      failedChannels: [],
    },
    [
      {
        channel: "pinterest",
        label: "Pinterest",
        code: "video_duration_too_long",
        blockers: [PINTEREST_VIDEO_TOO_LONG_MESSAGE],
      },
    ],
  );

  assert.equal(summary.total, 4);
  assert.equal(summary.successCount, 3);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.allSucceeded, false);
  assert.equal(summary.allFailed, false);
  assert.deepEqual(summary.failedChannels, ["pinterest"]);
  assert.deepEqual(summary.entries.at(-1), {
    channel: "pinterest",
    label: "Pinterest",
    ok: false,
    status: "failed",
    code: "video_duration_too_long",
    retryable: false,
    error: PINTEREST_VIDEO_TOO_LONG_MESSAGE,
    blockers: [PINTEREST_VIDEO_TOO_LONG_MESSAGE],
  });
});

test("la désélection d'image survit aux synchronisations de métadonnées", () => {
  const initialized = mergeBoosterChannelImageSelection({
    availableKeys: ["a", "b"],
    supportsImages: true,
  });
  assert.deepEqual(initialized, ["a", "b"]);

  const afterDeselect = mergeBoosterChannelImageSelection({
    availableKeys: ["a", "b"],
    previousAvailableKeys: ["a", "b"],
    previousSelectedKeys: ["a"],
    supportsImages: true,
  });
  assert.deepEqual(afterDeselect, ["a"]);

  const emptyStillEmpty = mergeBoosterChannelImageSelection({
    availableKeys: ["a", "b"],
    previousAvailableKeys: ["a", "b"],
    previousSelectedKeys: [],
    supportsImages: true,
  });
  assert.deepEqual(emptyStillEmpty, []);

  const restoredOrderedSubset = mergeBoosterChannelImageSelection({
    availableKeys: ["a", "b", "c", "d", "e"],
    previousSelectedKeys: ["c", "a", "e"],
    supportsImages: true,
  });
  assert.deepEqual(restoredOrderedSubset, ["c", "a", "e"]);

  const newFileStaysUnassigned = mergeBoosterChannelImageSelection({
    availableKeys: ["a", "b", "c"],
    previousAvailableKeys: ["a", "b"],
    previousSelectedKeys: ["a"],
    supportsImages: true,
  });
  assert.deepEqual(newFileStaysUnassigned, ["a"]);
});

test("les variantes fond clair et fond sombre ne dépendent plus de l'ordre des canaux", () => {
  assert.equal(getVideoPublicationProfileForChannel("site_web"), "light_background");
  assert.equal(getVideoPublicationProfileForChannel("facebook"), "default");

  const variants = (channels: Array<"site_web" | "facebook">) =>
    buildVideoTransformPlan(
      channels.map((channel) => ({
        channel,
        format: "1_1" as const,
        adaptationMode: "safe_frame" as const,
      })),
    )
      .map((entry) => entry.signature)
      .sort();

  assert.deepEqual(variants(["site_web", "facebook"]), variants(["facebook", "site_web"]));
  assert.deepEqual(variants(["site_web", "facebook"]), [
    "1_1:safe_frame",
    "1_1:safe_frame:light_background",
  ]);
});

test("le client conserve status, code et invalidChannels d'une erreur API", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        error: "Vidéo incompatible",
        code: "video_duration_too_long",
        invalidChannels: [{ channel: "tiktok" }],
      }),
      { status: 422, headers: { "content-type": "application/json" } },
    );

  await assert.rejects(
    postBoosterPublication({}, { fetchImpl, maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof BoosterPublishError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "video_duration_too_long");
      assert.deepEqual(error.invalidChannels, [{ channel: "tiktok" }]);
      return true;
    },
  );
});

test("un PNG opaque n'est pas gonflé en PNG lossless sur les surfaces iNrCy", () => {
  assert.equal(
    getBoosterOriginalPublicationExtension({
      channel: "site_web",
      sourceMime: "image/png",
      sourceHasAlpha: false,
    }),
    "jpg",
  );
  assert.equal(
    getBoosterOriginalPublicationExtension({
      channel: "site_web",
      sourceMime: "image/png",
      sourceHasAlpha: true,
    }),
    "png",
  );
});

test("une réponse fournisseur ambiguë interdit le fallback texte qui créerait un doublon", () => {
  assert.deepEqual(getProviderCreateFailureSafety({ requestThrew: true }), {
    safeTextFallback: false,
    requestMayHaveSucceeded: true,
  });
  assert.deepEqual(getProviderCreateFailureSafety({ httpStatus: 503 }), {
    safeTextFallback: false,
    requestMayHaveSucceeded: true,
  });
  assert.deepEqual(getProviderCreateFailureSafety({ httpStatus: 400 }), {
    safeTextFallback: true,
    requestMayHaveSucceeded: false,
  });
  assert.deepEqual(
    getProviderCreateFailureSafety({ successResponseMissingId: true }),
    { safeTextFallback: false, requestMayHaveSucceeded: true },
  );
});

test("les contrats UI du hotfix excluent réellement un canal et ne codent plus TikTok en dur dans le bilan pending", () => {
  const modal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
  const publish = read("app/dashboard/booster/publier/PublishModal.tsx");
  const route = read("app/api/booster/publish-now/route.ts");
  const facebook = read("lib/facebookPublish.ts");
  const linkedin = read("lib/linkedinPublish.ts");

  assert.doesNotMatch(modal, /TikTok a accepté l’envoi/);
  assert.doesNotMatch(modal, /statut TikTok dans iNrSend/);
  assert.match(publish, /const deselectChannel = \(key: ChannelKey\)/);
  assert.match(submission, /options\?\.channels !== undefined/);
  assert.match(route, /preflightFailuresByChannel/);
  assert.match(route, /resp\.safeTextFallback === true/);
  assert.match(facebook, /getProviderCreateFailureSafety/);
  assert.match(linkedin, /getProviderCreateFailureSafety/);
  assert.match(route, /video_variant_required/);
  assert.doesNotMatch(route, /preparePublicationVariants\(true\)/);
});
