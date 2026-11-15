import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleBusinessAccount, GoogleBusinessLocation } from "@/lib/googleBusinessLocations";
import { clearGmbSelectionMeta, clearGmbSelectionSettings } from "@/lib/googleBusinessSelectionPolicy";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { log } from "@/lib/observability/logger";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export type GmbSelectionValidation = {
  status: "valid" | "invalid" | "unknown" | "unselected";
  cleared: boolean;
  locationName: string | null;
};

/** Invalidate only a proven absent target. Google authentication remains intact.
 * A complete provider listing and the exact stored snapshot are both required;
 * neither a same-name replacement nor an incomplete listing authorizes a change.
 */
export async function reconcileGmbSelection({ db, userId, row, discovery }: {
  db: SupabaseClient;
  userId: string;
  row: RecordValue;
  discovery: { accounts: GoogleBusinessAccount[]; locations: GoogleBusinessLocation[]; complete: boolean };
}): Promise<GmbSelectionValidation> {
  const locationName = text(row.resource_id) || null;
  const result = (status: GmbSelectionValidation["status"], cleared = false): GmbSelectionValidation => ({ status, cleared, locationName });
  if (!locationName) return result("unselected");
  if (!discovery.complete) return result("unknown");
  if (!row.id || row.user_id !== userId || row.provider !== "google" || row.source !== "gmb" || row.product !== "gmb"
    || !["connected", "account_connected"].includes(text(row.status))) return result("unknown");

  const { data: mirror, error: mirrorReadError } = await db.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
  if (mirrorReadError) throw new Error("Impossible de vérifier la sélection Google Business pour le moment.");
  const settings = object(mirror?.settings);
  const gmbSettings = object(settings.gmb);
  const accountName = text(object(row.meta).account) || text(gmbSettings.accountName);
  const accountAccessible = discovery.accounts.some(account => account.name === accountName);
  if (accountAccessible && discovery.locations.some(location => location.accountName === accountName && location.name === locationName)) return result("valid");
  // Discovery deduplicates shared locations. If the parent came from a legacy
  // mirror, a different parent may have won that deduplication: absence of this
  // tuple is then inconclusive and must not clear a potentially valid choice.
  if (accountAccessible && discovery.locations.some(location => location.name === locationName)) return result("unknown");

  const accountHint = accountAccessible ? accountName : null;
  let update = db.from("integrations").update({
    status: "account_connected",
    resource_id: null,
    resource_label: null,
    meta: withCurrentConnectionVersion("channel:gmb", clearGmbSelectionMeta(row.meta, accountHint)),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("user_id", userId).eq("provider", "google").eq("source", "gmb").eq("product", "gmb");
  // OAuth callbacks do not always advance updated_at. Compare the complete
  // authentication/selection snapshot, including the JSONB revision, instead.
  for (const field of ["status", "email_address", "access_token_enc", "refresh_token_enc", "expires_at", "resource_id"] as const) {
    update = row[field] == null ? update.is(field, null) : update.eq(field, row[field]);
  }
  update = row.meta == null ? update.is("meta", null) : update.eq("meta", JSON.stringify(row.meta));
  const { data: changed, error: updateError } = await update.select("id").maybeSingle();
  if (updateError) throw new Error("La sélection Google Business n’a pas pu être actualisée.");
  if (!changed?.id) return result("unknown"); // A more recent user action won.

  // The official target is already cleared. Only clear the mirror if it still
  // points to that same old target; a concurrent explicit selection must win.
  const mirrorTargets = [gmbSettings.locationName, gmbSettings.resource_id, gmbSettings.location].map(text).filter(Boolean);
  if (mirror && mirrorTargets.every(target => target === locationName)) {
    const next = { ...settings, gmb: { ...clearGmbSelectionSettings(gmbSettings, accountHint), connected: true, configured: false } };
    try {
      const { error } = await db.from("pro_tools_configs").update({ settings: next }).eq("user_id", userId).eq("settings", JSON.stringify(settings));
      if (error) throw new Error("mirror_sync_failed");
    } catch {
      log.warn("google_business_selection_mirror_sync_failed", { user_id: userId, integration_id: String(row.id) });
    }
  }
  return result("invalid", true);
}
