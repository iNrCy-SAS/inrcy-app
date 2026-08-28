import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type NotificationInsertRow = {
  user_id: string;
  category: string;
  kind: string;
  title: string;
  body: string;
  cta_label?: string | null;
  cta_url?: string | null;
  read_at?: string | null;
  meta?: Record<string, unknown> | null;
  dedupe_key?: string | null;
};

type NotificationWriteResult = {
  data: Record<string, unknown> | null;
  inserted: boolean;
};

const NOTIFICATION_SELECT =
  "id, user_id, category, kind, title, body, cta_label, cta_url, read_at, meta, dedupe_key, created_at";

function isMissingInsertRpc(error: { code?: string; message?: string } | null) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    message.includes("inrcy_insert_notification_once")
  );
}

async function findExistingNotification(row: NotificationInsertRow) {
  const dedupeKey = String(row.dedupe_key || "").trim();
  if (!dedupeKey) return null;
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .eq("user_id", row.user_id)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as Record<string, unknown> | null;
}

/**
 * Atomic notification writer. The production RPC uses INSERT ... ON CONFLICT
 * DO NOTHING, so expected retries never emit a Postgres 23505 / REST 409.
 * The lookup fallback keeps older environments functional until the included
 * idempotent SQL repair has been applied.
 */
export async function insertNotificationOnce(
  row: NotificationInsertRow,
): Promise<NotificationWriteResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "inrcy_insert_notification_once",
    { p_notification: row },
  );

  if (!error) {
    const inserted = Boolean(data && typeof data === "object");
    return {
      data: inserted ? (data as Record<string, unknown>) : null,
      inserted,
    };
  }
  if (!isMissingInsertRpc(error)) throw error;

  const existing = await findExistingNotification(row);
  if (existing) return { data: existing, inserted: false };

  const fallback = await supabaseAdmin
    .from("notifications")
    .insert(row)
    .select(NOTIFICATION_SELECT)
    .single();
  if (!fallback.error) {
    return {
      data: (fallback.data || null) as Record<string, unknown> | null,
      inserted: true,
    };
  }
  if (fallback.error.code === "23505") {
    return {
      data: await findExistingNotification(row),
      inserted: false,
    };
  }
  throw fallback.error;
}
