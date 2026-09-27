import "server-only";

import sharp from "sharp";
import { verifyMediaLibraryContentToken } from "@/lib/mediaLibraryContentUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_GOOGLE_IMAGE_BYTES = 5_120 * 1_024;

function privateMediaId(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://inrcy-media.local");
    if (url.origin !== "https://inrcy-media.local") return null;
    const match = url.pathname.match(/^\/api\/media-library\/items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content$/i);
    const id = match?.[1] || "";
    return id && verifyMediaLibraryContentToken(id, url.searchParams.get("token") || "") ? id : null;
  } catch {
    return null;
  }
}

/** Google Ads receives image bytes, never a private preview link or arbitrary remote URL. */
export async function prepareGoogleSearchImageAsset(userId: string, imageUrl: string): Promise<string> {
  const mediaId = privateMediaId(imageUrl);
  if (!mediaId) {
    throw new Error("Pour joindre une image à Google Search, choisissez-la dans la médiathèque iNrCy ou importez-la d’abord. Les liens externes ne sont pas encore pris en charge par ce connecteur.");
  }

  const { data: media, error } = await supabaseAdmin
    .from("pro_media_library")
    .select("bucket_name,storage_path,media_type,size_bytes,is_active")
    .eq("id", mediaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !media || media.is_active === false || media.media_type !== "image") {
    throw new Error("L’image Google Search n’est plus disponible dans votre médiathèque iNrCy.");
  }
  if (Number(media.size_bytes || 0) > MAX_SOURCE_BYTES) {
    throw new Error("L’image choisie est trop volumineuse pour être préparée pour Google Search (20 Mo maximum à l’import).");
  }
  const bucket = String(media.bucket_name || "");
  const path = String(media.storage_path || "");
  if (!bucket || !path) throw new Error("Le fichier de l’image Google Search est introuvable.");

  const downloaded = await supabaseAdmin.storage.from(bucket).download(path);
  if (downloaded.error || !downloaded.data) {
    throw new Error("Le téléchargement de l’image Google Search depuis la médiathèque a échoué.");
  }
  if (downloaded.data.size > MAX_SOURCE_BYTES) {
    throw new Error("L’image choisie est trop volumineuse pour Google Search.");
  }

  try {
    const source = Buffer.from(await downloaded.data.arrayBuffer());
    const metadata = await sharp(source, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 300 || metadata.height < 300) {
      throw new Error("L’image Google Search doit mesurer au moins 300 × 300 pixels.");
    }
    // A square JPEG satisfies Google's required 1:1 ratio while staying under
    // its 5,120 KB limit. The original image remains untouched in the library.
    for (const quality of [85, 72, 60]) {
      const normalized = await sharp(source, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1_200, 1_200, { fit: "cover", position: "attention" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (normalized.length <= MAX_GOOGLE_IMAGE_BYTES) return normalized.toString("base64");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("L’image Google Search doit")) throw error;
    throw new Error("L’image ne peut pas être préparée pour Google Search. Choisissez un JPG ou PNG valide.");
  }
  throw new Error("L’image préparée dépasse la limite de 5 120 Ko de Google Search.");
}
