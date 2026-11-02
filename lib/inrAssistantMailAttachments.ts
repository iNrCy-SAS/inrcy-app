import type { SupabaseClient } from "@supabase/supabase-js";

export type InrAssistantMailAttachment = { bucket: "inrcy-pro-media"; path: string; name: string; type: string; size: number };
export const INR_ASSISTANT_MAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function parseInrAssistantMailAttachments(value: unknown): InrAssistantMailAttachment[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  const result: InrAssistantMailAttachment[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "bucket,name,path,size,type"
      || row.bucket !== "inrcy-pro-media" || typeof row.path !== "string" || row.path.length > 800 || !/^users\/[a-f0-9-]{36}\//i.test(row.path) || /\.\.|[\\\u0000-\u001f%]/.test(row.path)
      || typeof row.name !== "string" || !row.name.trim() || row.name.length > 180 || /[\r\n\u0000]/.test(row.name)
      || typeof row.type !== "string" || !/^(?:image|video|audio)\/[a-z0-9.+-]{1,80}$/i.test(row.type)
      || !Number.isSafeInteger(row.size) || row.size <= 0 || row.size > INR_ASSISTANT_MAIL_ATTACHMENT_BYTES) return null;
    result.push({ bucket: row.bucket, path: row.path, name: row.name, type: row.type, size: row.size });
  }
  if (new Set(result.map(item => item.path)).size !== result.length || result.reduce((total, item) => total + item.size, 0) > INR_ASSISTANT_MAIL_ATTACHMENT_BYTES) return null;
  return result;
}

/** Models select real IDs, never a bucket, URL or storage path. No file is copied or sent. */
export async function resolveInrAssistantMailAttachments(db: Pick<SupabaseClient, "from">, accountId: string, ids: unknown): Promise<InrAssistantMailAttachment[] | null> {
  if (!uuid.test(accountId) || !Array.isArray(ids) || !ids.length || ids.length > 5 || ids.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(ids).size !== ids.length) return null;
  try {
  const { data, error } = await db.from("pro_media_library")
    .select("id,user_id,bucket_name,storage_path,original_file_name,mime_type,size_bytes,is_active")
    .eq("user_id", accountId).in("id", ids).eq("is_active", true).limit(6).abortSignal(AbortSignal.timeout(5000));
  if (error || !Array.isArray(data) || data.length !== ids.length || new Set(data.map(row => row.id)).size !== ids.length
    || data.some(row => row.user_id !== accountId || row.is_active !== true || !ids.includes(row.id) || typeof row.storage_path !== "string" || !row.storage_path.startsWith(`users/${accountId}/`))) return null;
  return parseInrAssistantMailAttachments(ids.map(id => {
    const row = data.find(value => value.id === id)!;
    return { bucket: row.bucket_name, path: row.storage_path, name: row.original_file_name, type: row.mime_type, size: row.size_bytes };
  }));
  } catch { return null; }
}

/** Keep every existing attachment, deduplicate stable storage references and
 * fail atomically if the result exceeds the bounded assistant attachment limit. */
export function mergeInrAssistantMailAttachments<T extends { bucket: string; path: string; size?: number | null }>(existing: T[], incoming: InrAssistantMailAttachment[]): Array<T | InrAssistantMailAttachment> | null {
  const added = incoming.filter(item => !existing.some(previous => previous.bucket === item.bucket && previous.path === item.path));
  const merged = [...existing, ...added];
  if (merged.length > 10 || merged.some(item => typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size <= 0) || merged.reduce((total, item) => total + (item.size ?? 0), 0) > INR_ASSISTANT_MAIL_ATTACHMENT_BYTES) return null;
  return merged;
}
