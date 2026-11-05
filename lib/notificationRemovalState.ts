import "server-only";
import { createHash } from "node:crypto";
export const NOTIFICATION_REMOVAL_FIELDS = ["id", "user_id", "category", "kind", "title", "body", "cta_label", "cta_url", "read_at", "meta", "dedupe_key", "created_at"] as const;
export const NOTIFICATION_REMOVAL_SELECT = "id,user_id,category,kind,title,body,cta_label,cta_url,read_at,meta,dedupe_key,created_at";
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export function notificationRemovalFingerprint(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(NOTIFICATION_REMOVAL_FIELDS.map(field => [field, canonical(value[field] ?? null)]))).digest("hex");
}
