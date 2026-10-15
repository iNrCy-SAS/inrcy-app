import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROVIDER_TEMP_PATH = new RegExp(`^${UUID}/_provider-temp/${UUID}/[0-9]+\\.(jpg|png|webp)$`, "i");

/** The service-only RPC lists only provider inputs older than two hours. */
export async function purgeExpiredAiMediaProviderImages(limit = 100) {
  const batchSize = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 100;
  const listed = await supabaseAdmin.rpc("list_expired_ai_media_provider_images", { p_batch_size: batchSize });
  if (listed.error) return { inspected: 0, removed: 0, errors: ["provider_temp_list_failed"] };
  const rows = Array.isArray(listed.data) ? listed.data.slice(0, batchSize) : [];
  const paths = new Set<string>();
  let invalid = false;
  for (const row of rows) {
    const path = typeof row?.storage_path === "string" ? row.storage_path : "";
    if (!PROVIDER_TEMP_PATH.test(path)) { invalid = true; continue; }
    paths.add(path);
  }
  const errors = invalid ? ["provider_temp_path_rejected"] : [];
  if (!paths.size) return { inspected: rows.length, removed: 0, errors };
  // Storage must delete both the object and its metadata; never DELETE storage.objects.
  const deleted = await supabaseAdmin.storage.from("inrcy-pro-media").remove([...paths]);
  if (deleted.error) errors.push("provider_temp_delete_failed");
  return { inspected: rows.length, removed: deleted.error ? 0 : paths.size, errors };
}
