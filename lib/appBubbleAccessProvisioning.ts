import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createDefaultBubbleAccessRows } from "@/lib/bubbleAccess";

/**
 * Applies the canonical Bubble Access defaults to an account that has just
 * been created. This function is intentionally for NEW accounts only because
 * it overwrites every key with its product default.
 *
 * Keeping this explicit in the application provisions the current channel
 * catalogue even while database triggers are being updated.
 */
export async function provisionNewAccountBubbleAccess(accountId: string): Promise<void> {
  const rows = createDefaultBubbleAccessRows(accountId);
  const { error } = await supabaseAdmin
    .from("app_bubble_access")
    .upsert(rows, { onConflict: "user_id,bubble_key" });

  if (error) {
    throw new Error(`INRCY_BUBBLE_ACCESS_PROVISIONING_FAILED:${error.message || "unknown_error"}`);
  }
}
