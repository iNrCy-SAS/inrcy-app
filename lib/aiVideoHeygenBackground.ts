import "server-only";
import sharp from "sharp";
import { generateAiMediaImage } from "@/lib/aiMediaGateway";
import { resolveAiMediaNativeImageSize } from "./aiMediaImageProviderRequest.ts";
import type { AiVideoProviderGenerationArgs } from "./aiVideoProviderTypes.ts";

export function buildHeygenBackgroundPrompt(args: AiVideoProviderGenerationArgs): string {
  return [
    "Create one photorealistic EMPTY LOCATION image to be used behind a talking avatar.",
    "The user location is authoritative. Reproduce its setting, season, objects and light.",
    "Do not draw people, faces, silhouettes, avatars, logos, captions or written text.",
    "Ignore dialogue and speaking actions: create only the physical surroundings.",
    "Eye-level camera, realistic perspective, open foreground with visible ground for the presenter.",
    "Fill the frame. No white studio backdrop unless specifically requested by the user.",
    "User brief: " + JSON.stringify((args.request.freePrompt || args.creativeBrief || "").slice(0,1500)),
    "Visual direction: " + JSON.stringify((args.plan.scenes[0]?.visualBrief || "").slice(0,1500)),
  ].join("\n");
}

/** Original people never enter an image generator: only a separate background is prepared. */
export async function prepareHeygenBackground(args: AiVideoProviderGenerationArgs, preparedReferences: readonly Buffer[]): Promise<Buffer> {
  args.signal?.throwIfAborted();
  const environmentIndex = args.request.inspirationImages.findIndex(image => image.role === "environment");
  const source = environmentIndex >= 0 ? preparedReferences[environmentIndex] : (await generateAiMediaImage({
    accountId: args.accountId, imageEngine: "flux", operation: "generate",
    format: args.request.format, identityMode: "auto", identityReferences: [], officialLogo: null,
    size: resolveAiMediaNativeImageSize(args.request.format), prompt: buildHeygenBackgroundPrompt(args), signal: args.signal,
  })).buffer;
  if (!source?.length) throw new Error("ai_media_heygen_background_missing");
  return normalizeHeygenImage(source,args.request.format,false);
}

/** Preserve the original portrait framing; HeyGen owns the final video canvas.
 * Forcing a portrait to the output ratio can create white side panels upstream. */
export async function prepareHeygenAvatarImage(source: Buffer, format: AiVideoProviderGenerationArgs["request"]["format"]): Promise<Buffer> {
  return normalizeHeygenImage(source,format,true);
}

async function normalizeHeygenImage(source: Buffer, format: AiVideoProviderGenerationArgs["request"]["format"], portrait: boolean): Promise<Buffer> {
  const [width,height] = resolveAiMediaNativeImageSize(format).split("x").map(Number);
  const scale = Math.min(1,1280/Math.max(width,height));
  const image = sharp(source,{failOn:"error",limitInputPixels:50_000_000}).rotate();
  if (portrait) image.resize({width:1280,height:1280,fit:"inside",withoutEnlargement:true});
  else image.resize({width:Math.round(width*scale),height:Math.round(height*scale),fit:"cover",position:"centre"});
  image.removeAlpha().toColourspace("srgb");
  let buffer = await image.clone().png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();
  if (buffer.length > 4*1024*1024) buffer = await image.png({compressionLevel:9,palette:true,colours:256}).toBuffer();
  return buffer;
}

/** Audio-driven silent animation keeps the narrator separate from visible mouths. */
export function createHeygenSilenceWav(durationSeconds: number): Buffer {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) {
    throw new RangeError("ai_media_heygen_silence_duration_invalid");
  }
  const sampleRate = 16_000;
  const dataBytes = Math.max(1, Math.round(durationSeconds * sampleRate)) * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  return wav;
}
