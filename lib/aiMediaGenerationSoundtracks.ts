import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  selectAiMediaSoundtrack,
  type AiMediaSoundtrackDefinition,
} from "@/lib/aiMediaSoundtrackCatalog";

export type LoadedAiMediaSoundtrack = AiMediaSoundtrackDefinition & {
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
  durationSeconds: 8;
};

/**
 * Charge uniquement un son original livré avec iNrCy. Aucun média distant ni
 * contenu fourni par un tiers n'entre dans le mixage final.
 */
export async function loadAiMediaSoundtrack(
  prompt: string,
): Promise<LoadedAiMediaSoundtrack> {
  const definition = selectAiMediaSoundtrack(prompt);
  const absolutePath = path.join(
    process.cwd(),
    "assets",
    "media-generation",
    "soundtracks",
    definition.fileName,
  );
  const buffer = await readFile(absolutePath);
  if (buffer.byteLength < 44) throw new Error("ai_soundtrack_asset_invalid");
  return {
    ...definition,
    absolutePath,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.byteLength,
    durationSeconds: 8,
  };
}
