import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createDefaultBubbleAccessRows } from "@/lib/bubbleAccess";
import { withNewAccountNativeChannelDefaults } from "@/lib/newAccountNativeChannelDefaults";

async function provisionNewAccountNativeChannelDefaults(accountId: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await supabaseAdmin.from("pro_tools_configs").select("settings")
      .eq("user_id", accountId).maybeSingle();
    if (current.error) throw new Error(`INRCY_NATIVE_CHANNEL_DEFAULTS_FAILED:${current.error.message || "read_error"}`);
    const previous = current.data?.settings ?? null;
    const next = withNewAccountNativeChannelDefaults(previous);
    if (next === previous) return;
    if (current.data) {
      let update = supabaseAdmin.from("pro_tools_configs").update({ settings: next }).eq("user_id", accountId);
      update = previous === null ? update.is("settings", null) : update.eq("settings", JSON.stringify(previous));
      const saved = await update.select("user_id");
      if (saved.error) throw new Error(`INRCY_NATIVE_CHANNEL_DEFAULTS_FAILED:${saved.error.message || "update_error"}`);
      if (saved.data?.length) return;
    } else {
      const created = await supabaseAdmin.from("pro_tools_configs").insert({ user_id: accountId, settings: next });
      if (created.error?.code === "23505") continue;
      if (created.error) throw new Error(`INRCY_NATIVE_CHANNEL_DEFAULTS_FAILED:${created.error.message || "insert_error"}`);
      return;
    }
  }
  throw new Error("INRCY_NATIVE_CHANNEL_DEFAULTS_CONCURRENT_SAVE");
}

/**
 * Applies the canonical Bubble Access defaults to an account that has just
 * been created. This function is intentionally for NEW accounts only because
 * it overwrites every key with its product default.
 *
 * Keeping this explicit in the application provisions the current channel
 * catalogue even while database triggers are being updated.
 */
export async function provisionNewAccountBubbleAccess(accountId: string): Promise<void> {
  if (!accountId.trim()) throw new Error("INRCY_BUBBLE_ACCESS_PROVISIONING_FAILED:account_required");
  const rows = createDefaultBubbleAccessRows(accountId);
  const { error } = await supabaseAdmin
    .from("app_bubble_access")
    .upsert(rows, { onConflict: "user_id,bubble_key" });

  if (error) {
    throw new Error(`INRCY_BUBBLE_ACCESS_PROVISIONING_FAILED:${error.message || "unknown_error"}`);
  }
  await provisionNewAccountNativeChannelDefaults(accountId);
}
