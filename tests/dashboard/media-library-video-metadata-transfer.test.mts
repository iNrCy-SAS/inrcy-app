import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  hasCompleteVideoMetadata,
  mergeTransferredMediaMetadata,
  normalizeTransferredMediaMetadata,
} from "../../lib/mediaMetadataTransfer.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("les métadonnées SQL d'une vidéo optimisée sont normalisées", () => {
  const metadata = normalizeTransferredMediaMetadata({
    duration_seconds: "46.14",
    width: 1080,
    height: 1920,
  });

  assert.deepEqual(metadata, {
    durationSeconds: 46.14,
    width: 1080,
    height: 1920,
  });
  assert.equal(hasCompleteVideoMetadata(metadata), true);
});

test("une preuve FFmpeg complète une ancienne ligne SQL incomplète", () => {
  assert.deepEqual(
    normalizeTransferredMediaMetadata({
      media_metadata: {
        video_normalization: {
          source: {
            probeProvenance: "server_ffmpeg",
            durationSeconds: 46.14,
            orientedWidth: 1080,
            orientedHeight: 1920,
          },
        },
      },
    }),
    { durationSeconds: 46.14, width: 1080, height: 1920 },
  );
});

test("les valeurs navigateur ne remplacent pas une durée SQL valide par zéro", () => {
  assert.deepEqual(
    mergeTransferredMediaMetadata(
      { width: 1080, height: 1920, duration: 0 },
      { duration_seconds: "46.14" },
    ),
    { durationSeconds: 46.14, width: 1080, height: 1920 },
  );
});

test("Booster transmet les infos pour un média optimisé ou déjà compatible", () => {
  const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const itemsRoute = read("app/api/media-library/items/route.ts");

  assert.match(publishModal, /transferredMetadata: videos\[0\] \|\| null/);
  assert.match(publishModal, /buildTransferredBoosterVideoMetadata/);
  assert.match(publishModal, /setPreparedWorkspaceMedia\(\[\.\.\.preparedMedia\]\)/);
  assert.match(publishModal, /video\.onloadedmetadata = \(\) =>/);
  assert.match(itemsRoute, /duration_seconds: metadata\.durationSeconds/);
});
