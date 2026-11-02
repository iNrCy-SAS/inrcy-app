import type { BoosterVideoTransformedVariant } from "./boosterVideoTransforms.ts";

type CopyOptions = {
  sourceName: string;
  sourceMediaId?: string | null;
  channel: string;
  format: string;
  adaptationMode: string;
  variants: BoosterVideoTransformedVariant[];
  isCurrent: () => boolean;
};
type UploadOptions = {
  title: string; source: string; width: number | null; height: number | null;
  durationSeconds: number | null; tags: string[]; metadata: Record<string, unknown>;
};
type Ports = {
  fetch: typeof fetch;
  upload: (file: File, options: UploadOptions) => Promise<Record<string, unknown>>;
};

async function boundedRead<T>(milliseconds: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("La lecture du média a dépassé le délai prévu. Aucun nouvel import n’a été relancé.")); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** A transformation alone is not a library save. Persist the actual generated
 * bytes as a separate native item, then read that owned item back. Never replace
 * or delete the original, and never announce success from an upload URL alone. */
export async function persistStudioVideoRetouch(options: CopyOptions, ports: Ports) {
  const assertCurrent = () => { if (!options.isCurrent()) throw new Error("La vidéo ou le compte a changé. La suite de l’enregistrement a été arrêtée."); };
  assertCurrent();
  const variant = options.variants.find(value => value.channel === options.channel
    && value.format === options.format && value.adaptationMode === options.adaptationMode
    && value.contentType === "video/mp4" && value.storagePath && value.publicUrl
    && Number.isSafeInteger(value.size) && value.size > 0);
  if (!variant) throw new Error("Aucune variante correspondant au format demandé n’a été produite. L’original est conservé.");
  const blob = await boundedRead(120_000, async signal => {
    const response = await ports.fetch(variant.publicUrl, { cache: "no-store", signal });
    assertCurrent();
    if (!response.ok) throw new Error("La copie vidéo préparée n’est pas disponible.");
    return response.blob();
  });
  assertCurrent();
  if (blob.size !== variant.size || blob.type.split(";")[0] !== "video/mp4") throw new Error("La copie vidéo reçue ne correspond pas à la variante préparée.");
  const baseName = options.sourceName.replace(/\.[^.]+$/, "").slice(0, 140) || "video-inrstudio";
  const file = new File([blob], `${baseName}-retouche-${options.format}.mp4`, { type: "video/mp4" });
  const item = await ports.upload(file, {
    title: `${baseName} — retouche ${options.format}`, source: "studio_video_retouch",
    width: variant.width || variant.target.width, height: variant.height || variant.target.height,
    durationSeconds: variant.duration, tags: ["inrstudio", "retouche-video"],
    metadata: { studio_action: "retouch_video", source_media_id: options.sourceMediaId || null,
      source_name: options.sourceName, channel: options.channel, format: options.format,
      adaptation_mode: options.adaptationMode, transformation_signature: variant.signature },
  });
  assertCurrent();
  const id = item.id;
  if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) || id === options.sourceMediaId) throw new Error("La nouvelle copie n’a pas été identifiée dans Mes médias.");
  const { verifiedResponse, payload } = await boundedRead(15_000, async signal => {
    const verifiedResponse = await ports.fetch(`/api/media-library/items?id=${encodeURIComponent(id)}`, { cache: "no-store", signal });
    const payload = await verifiedResponse.json().catch(() => null);
    return { verifiedResponse, payload };
  });
  assertCurrent();
  const saved = payload?.items?.find((value: Record<string, unknown>) => value.id === id);
  const metadata = saved?.media_metadata;
  if (!verifiedResponse.ok || !saved || saved.media_type !== "video" || saved.is_active === false
    || Number(saved.size_bytes) !== file.size || metadata?.studio_action !== "retouch_video"
    || metadata?.format !== options.format || metadata?.adaptation_mode !== options.adaptationMode
    || metadata?.transformation_signature !== variant.signature) throw new Error("La copie a été transmise, mais sa présence exacte dans Mes médias n’a pas pu être vérifiée.");
  return saved as Record<string, unknown> & { id: string };
}
