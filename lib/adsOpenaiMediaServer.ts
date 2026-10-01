import "server-only";

import sharp from "sharp";
import { CHATGPT_ADS_MAX_IMAGE_BYTES, CHATGPT_ADS_MIN_IMAGE_SIDE_PX } from "./adsCampaignMediaPolicy.ts";
import { verifyMediaLibraryContentToken } from "./mediaLibraryContentUrl.ts";
import { createSafeStorageSignedUrl } from "./safeStorageSignedUrl.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";

function publicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:" && !url.username && !url.password && value.length <= 2048
      && Boolean(hostname) && hostname !== "localhost" && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".local") && !hostname.endsWith(".internal")
      && hostname !== "::1" && !/^(?:0|10|127|169\.254|192\.168)\./.test(hostname)
      && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
}

/** OpenAI fetches a signed copy; inspect the owned image before any provider mutation. */
export async function resolveOpenaiAdsImageUrl(userId: string, value: string): Promise<{ imageUrl: string; mediaStableId: string }> {
  const source = value.trim();
  let mediaId = "";
  try {
    const url = new URL(source, "https://inrcy-media.local");
    mediaId = url.pathname.match(/^\/api\/media-library\/items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content$/i)?.[1] || "";
    if (!source.startsWith("/") || source.startsWith("//") || url.origin !== "https://inrcy-media.local"
      || !mediaId || !verifyMediaLibraryContentToken(mediaId, url.searchParams.get("token") || "")) mediaId = "";
  } catch { /* invalid media reference */ }
  if (!mediaId) throw new Error("Choisissez une image de votre médiathèque iNrCy. Les liens externes ne sont pas vérifiables pour ChatGPT Ads.");
  const { data, error } = await supabaseAdmin.from("pro_media_library")
    .select("bucket_name,storage_path,media_type,size_bytes,is_active")
    .eq("id", mediaId).eq("user_id", userId).maybeSingle();
  if (error || !data || data.is_active === false || data.media_type !== "image") {
    throw new Error("L’image ChatGPT Ads choisie n’est plus disponible dans votre médiathèque.");
  }
  if (Number(data.size_bytes || 0) > CHATGPT_ADS_MAX_IMAGE_BYTES) {
    throw new Error("L’image ChatGPT Ads dépasse 20 Mo. Choisissez un fichier plus léger.");
  }
  const bucket = String(data.bucket_name || "");
  const storagePath = String(data.storage_path || "");
  if (!bucket || !storagePath) throw new Error("Le fichier de l’image ChatGPT Ads est introuvable.");
  const downloaded = await supabaseAdmin.storage.from(bucket).download(storagePath);
  if (downloaded.error || !downloaded.data || downloaded.data.size > CHATGPT_ADS_MAX_IMAGE_BYTES) {
    throw new Error("L’image ChatGPT Ads ne peut pas être vérifiée pour le moment.");
  }
  try {
    const metadata = await sharp(Buffer.from(await downloaded.data.arrayBuffer()), {
      failOn: "error", limitInputPixels: 40_000_000,
    }).metadata();
    if ((metadata.format !== "jpeg" && metadata.format !== "png") || !metadata.width || !metadata.height
      || metadata.width !== metadata.height || metadata.width < CHATGPT_ADS_MIN_IMAGE_SIDE_PX) {
      throw new Error(`ChatGPT Ads demande une image JPG ou PNG carrée d’au moins ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} × ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} pixels.`);
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("ChatGPT Ads demande")) throw cause;
    throw new Error("L’image ChatGPT Ads ne peut pas être lue. Choisissez un JPG ou PNG carré valide.");
  }
  const signed = await createSafeStorageSignedUrl(
    bucket, storagePath, 60 * 60,
  );
  if (!signed || !publicHttpsUrl(signed)) throw new Error("L’image ChatGPT Ads ne peut pas être préparée pour l’envoi.");
  return { imageUrl: signed, mediaStableId: mediaId };
}
