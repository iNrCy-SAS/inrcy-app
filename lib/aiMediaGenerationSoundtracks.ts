import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  selectAiMediaSoundtrack,
  AI_MEDIA_SOUNDTRACKS,
  type AiMediaSoundtrackDefinition,
  type AiMediaSoundtrackDuration,
  type AiMediaSoundtrackSelectionOptions,
} from "@/lib/aiMediaSoundtrackCatalog";

export type LoadedAiMediaSoundtrack = AiMediaSoundtrackDefinition & {
  fileName: string;
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
  durationSeconds: AiMediaSoundtrackDuration;
};

export type AiMediaSoundtrackLoadOptions =
  AiMediaSoundtrackSelectionOptions & {
    durationSeconds?: AiMediaSoundtrackDuration;
    /** Server-selected persisted track for deterministic series/recovery. */
    soundtrackId?: string;
  };

/**
 * Charge uniquement un son original livré avec iNrCy. Aucun média distant ni
 * contenu fourni par un tiers n'entre dans le mixage final.
 */
export async function loadAiMediaSoundtrack(
  prompt: string,
  options: AiMediaSoundtrackLoadOptions = {},
): Promise<LoadedAiMediaSoundtrack> {
  const definition = options.soundtrackId ? AI_MEDIA_SOUNDTRACKS.find(track => track.id === options.soundtrackId) : selectAiMediaSoundtrack(prompt, options);
  if (!definition) throw new Error("ai_soundtrack_id_invalid");
  const requestedDuration = options.durationSeconds ?? 24;
  // The compositor loops/trims this original asset to the requested duration.
  const durationSeconds = requestedDuration <= 8 ? 8 : requestedDuration <= 16 ? 16 : 24;
  const fileName = `${definition.id}-${durationSeconds}s.wav`;
  const absolutePath = path.join(
    process.cwd(),
    "assets",
    "media-generation",
    "soundtracks",
    fileName,
  );
  const buffer = await readFile(absolutePath);
  if (buffer.byteLength < 44) throw new Error("ai_soundtrack_asset_invalid");
  return {
    ...definition,
    fileName,
    absolutePath,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.byteLength,
    durationSeconds,
  };
}
