import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function tikTokNativeCapabilityScope(appId, integration) {
  if (typeof appId !== "string" || !/^\d{5,30}$/.test(appId) || !integration || integration.status !== "connected"
    || typeof integration.resource_id !== "string" || !/^\d{5,30}$/.test(integration.resource_id) || typeof integration.access_token_enc !== "string" || !integration.access_token_enc || !integration.id) throw new Error("connected_ads_integration_required");
  const meta = integration.meta && typeof integration.meta === "object" && !Array.isArray(integration.meta) ? integration.meta : {};
  const key = JSON.stringify([integration.id, integration.status, integration.resource_id, integration.access_token_enc, integration.refresh_token_enc, integration.expires_at, meta.token_lifecycle]);
  return { appId: String(appId), advertiserId: integration.resource_id, integrationFingerprint: createHash("sha256").update(key).digest("hex"),
    context: { objectiveType: "TRAFFIC", placements: ["PLACEMENT_TIKTOK"], language: "fr", levelRange: "TO_CITY" } };
}
async function main() {
  const args = process.argv.slice(2), userId = args.length === 2 && args[0] === "--user-id" ? args[1] : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error("owner_user_id_required");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "", key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key || !process.env.TIKTOK_ADS_APP_ID) throw new Error("server_configuration_missing");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.from("integrations").select("id,status,resource_id,access_token_enc,refresh_token_enc,expires_at,meta")
    .eq("user_id", userId).eq("provider", "tiktok").eq("source", "tiktok_ads").eq("product", "ads").maybeSingle();
  if (error) throw new Error("integration_read_failed");
  // Only a hash and public identifiers leave this process. No token is decrypted or printed.
  process.stdout.write(JSON.stringify({ scope: tikTokNativeCapabilityScope(process.env.TIKTOK_ADS_APP_ID, data), authorityVerified: false }, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("TikTok scope unavailable: check the owner and server configuration.\n"); process.exitCode = 1; });
}
