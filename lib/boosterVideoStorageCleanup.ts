import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BOOSTER_BUCKET = "booster";
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(?:$|[?#])/i;
const MAX_ROWS_TO_SCAN = 2000;

type JsonRecord = Record<string, unknown>;

function normalizeSafeSegment(value: string, fallback: string) {
  const safe = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 90);

  return safe || fallback;
}

function sanitizeUserId(userId: string) {
  return normalizeSafeSegment(userId, "user").replace(/\./g, "-");
}

function extractPathFromPublicUrl(rawValue: string) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";

  if (!/^https?:\/\//i.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const marker = `/storage/v1/object/public/${BOOSTER_BUCKET}/`;
    const index = url.pathname.indexOf(marker);
    if (index < 0) return "";
    return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    return "";
  }
}

export function sanitizeBoosterVideoStoragePath(userId: string, rawPath: unknown) {
  const extracted = extractPathFromPublicUrl(String(rawPath || "").trim())
    .replace(/\\/g, "/")
    .replace(/\u0000/g, "")
    .replace(/^\/+/, "")
    .trim();

  if (!extracted || !VIDEO_EXT_RE.test(extracted)) return "";
  if (extracted.includes("..")) return "";

  const safeUserId = sanitizeUserId(userId);
  const rawUserId = String(userId || "").trim();
  const allowedPrefixes = [safeUserId, rawUserId].filter(Boolean).map((value) => `${value}/`);
  if (!allowedPrefixes.some((prefix) => extracted.startsWith(prefix))) return "";

  return extracted;
}

function looksLikeVideoObject(record: JsonRecord, parentKey = "") {
  const key = parentKey.toLowerCase();
  const mediaType = String(record.mediaType || record.media_type || "").toLowerCase();
  const mime = String(record.type || record.mime || record.mimeType || record.video_mime || "").toLowerCase();
  const name = String(record.name || record.fileName || record.filename || "");
  const url = String(record.publicUrl || record.public_url || record.url || record.href || record.videoUrl || record.video_url || "");
  const path = String(record.storagePath || record.storage_path || record.videoPath || record.video_path || record.path || "");

  return (
    key.includes("video") ||
    mediaType === "video" ||
    mime.startsWith("video/") ||
    VIDEO_EXT_RE.test(name) ||
    VIDEO_EXT_RE.test(url) ||
    VIDEO_EXT_RE.test(path)
  );
}

export function extractBoosterVideoStoragePaths(userId: string, input: unknown) {
  const paths = new Set<string>();

  const visit = (value: unknown, parentKey = "") => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, parentKey));
      return;
    }
    if (typeof value !== "object") return;

    const record = value as JsonRecord;
    const isVideo = looksLikeVideoObject(record, parentKey);
    if (isVideo) {
      for (const rawPath of [
        record.storagePath,
        record.storage_path,
        record.videoPath,
        record.video_path,
        record.path,
        record.publicUrl,
        record.public_url,
        record.url,
        record.videoUrl,
        record.video_url,
      ]) {
        const path = sanitizeBoosterVideoStoragePath(userId, rawPath);
        if (path) paths.add(path);
      }
    }

    for (const [key, child] of Object.entries(record)) {
      visit(child, key);
    }
  };

  visit(input);
  return Array.from(paths);
}

async function safeSelectRows<T>(builder: PromiseLike<{ data: T[] | null; error: unknown }>) {
  try {
    const { data, error } = await builder;
    if (error) return [] as T[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [] as T[];
  }
}

async function getReferencedBoosterVideoPaths(userId: string, candidatePaths: string[]) {
  const candidates = new Set(candidatePaths.map((path) => sanitizeBoosterVideoStoragePath(userId, path)).filter(Boolean));
  const referenced = new Set<string>();
  if (!candidates.size) return referenced;

  const addFrom = (value: unknown) => {
    for (const path of extractBoosterVideoStoragePaths(userId, value)) {
      if (candidates.has(path)) referenced.add(path);
    }
  };

  const eventRows = await safeSelectRows<{ payload: unknown }>(
    supabaseAdmin
      .from("app_events")
      .select("payload")
      .eq("user_id", userId)
      .in("module", ["booster", "propulser"])
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS_TO_SCAN),
  );
  for (const row of eventRows) addFrom(row.payload);

  const publicationRows = await safeSelectRows<{ video_path?: string | null; media_metadata?: unknown }>(
    supabaseAdmin
      .from("publications")
      .select("video_path,media_metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS_TO_SCAN),
  );
  for (const row of publicationRows) addFrom({ video_path: row.video_path, media_metadata: row.media_metadata, mediaType: "video" });

  const articleRows = await safeSelectRows<{ video_path?: string | null; media_metadata?: unknown }>(
    supabaseAdmin
      .from("site_articles")
      .select("video_path,media_metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS_TO_SCAN),
  );
  for (const row of articleRows) addFrom({ video_path: row.video_path, media_metadata: row.media_metadata, mediaType: "video" });

  return referenced;
}

export async function cleanupUnusedBoosterVideoStorage(userId: string, rawPaths: unknown[]) {
  const paths = Array.from(
    new Set(rawPaths.map((path) => sanitizeBoosterVideoStoragePath(userId, path)).filter(Boolean)),
  );
  if (!paths.length) return { removed: [] as string[], kept: [] as string[] };

  const referenced = await getReferencedBoosterVideoPaths(userId, paths);
  const removable = paths.filter((path) => !referenced.has(path));
  const kept = paths.filter((path) => referenced.has(path));

  if (removable.length) {
    const { error } = await supabaseAdmin.storage.from(BOOSTER_BUCKET).remove(removable);
    if (error) throw error;
    const registryCleanup = await supabaseAdmin
      .from("pro_media_library")
      .update({
        is_active: false,
        upload_status: "removed",
        upload_progress: 0,
        publication_status: "removed",
        original_deleted_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("bucket_name", BOOSTER_BUCKET)
      .in("storage_path", removable);
    if (registryCleanup.error) throw registryCleanup.error;
  }

  return { removed: removable, kept };
}

export async function cleanupReplacedBoosterVideoStorage(userId: string, previousPayload: unknown, nextPayload: unknown) {
  const previousPaths = extractBoosterVideoStoragePaths(userId, previousPayload);
  if (!previousPaths.length) return { removed: [] as string[], kept: [] as string[] };

  const nextPaths = new Set(extractBoosterVideoStoragePaths(userId, nextPayload));
  const replacedPaths = previousPaths.filter((path) => !nextPaths.has(path));
  return cleanupUnusedBoosterVideoStorage(userId, replacedPaths);
}

export async function cleanupBoosterVideoStorageFromPayloads(userId: string, payloads: unknown[]) {
  const paths = payloads.flatMap((payload) => extractBoosterVideoStoragePaths(userId, payload));
  return cleanupUnusedBoosterVideoStorage(userId, paths);
}
