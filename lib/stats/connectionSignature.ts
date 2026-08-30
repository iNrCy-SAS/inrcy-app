import "server-only";

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONNECTION_RECONNECT_MARKER_KEYS,
  CONNECTION_REQUIRED_VERSIONS,
} from "@/lib/connectionVersions";
import { INRCY_STATS_CACHE_SCHEMA_VERSION } from "@/lib/stats/cacheSchema";

type AnyRec = Record<string, unknown>;

function asRecord(value: unknown): AnyRec {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRec) : {};
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const rec = asRecord(value);
  return `{${Object.keys(rec)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(rec[key])}`)
    .join(",")}}`;
}

function safeMetaSnapshot(metaValue: unknown): AnyRec {
  const meta = asRecord(metaValue);
  const picked: AnyRec = {};
  for (const key of [
    "connection_version",
    "connectionVersion",
    "auth_version",
    "authVersion",
    "selected",
    "page_id",
    "page_url",
    "instagram_business_account_id",
    "ig_user_id",
    "organization_urn",
    "organizationUrn",
    "location_name",
    "locationName",
    ...CONNECTION_RECONNECT_MARKER_KEYS,
    "needs_reconnect_at",
    "needs_reconnect_reason",
    "needs_reconnect_channel",
    "needs_reconnect_stage",
  ]) {
    const value = meta[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      picked[key] = value;
    }
  }
  return picked;
}

function pushPart(parts: string[], label: string, value: unknown) {
  parts.push(`${label}:${stableStringify(value)}`);
}

/**
 * Signature légère de l'état qui impacte les chiffres Générateur + iNrStats.
 *
 * Elle évite de relancer les APIs à chaque refresh de page :
 * - si la signature est identique au dernier cache stats, on garde le cache ;
 * - si une connexion/config a changé, on recalcule automatiquement une seule fois.
 *
 * On n'inclut volontairement pas les tokens chiffrés ni les updated_at de refresh token,
 * pour ne pas déclencher un recalcul inutile après un simple renouvellement technique.
 */
export async function buildStatsConnectionSignature(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const parts: string[] = [];

  pushPart(parts, "stats_cache_schema", INRCY_STATS_CACHE_SCHEMA_VERSION);

  pushPart(parts, "required_versions", CONNECTION_REQUIRED_VERSIONS);

  try {
    const { data = [] } = await supabase
      .from("integrations")
      .select("provider,source,product,status,resource_id,resource_label,display_name,email_address,expires_at,access_token_enc,refresh_token_enc,settings,meta")
      .eq("user_id", userId);

    const rows = Array.isArray(data) ? data : [];
    rows
      .map((row) => {
        const rec = asRecord(row);
        return {
          provider: String(rec.provider ?? ""),
          source: String(rec.source ?? ""),
          product: String(rec.product ?? ""),
          status: String(rec.status ?? ""),
          resource_id: String(rec.resource_id ?? ""),
          resource_label: String(rec.resource_label ?? ""),
          display_name: String(rec.display_name ?? ""),
          email_address: String(rec.email_address ?? ""),
          expires_at: String(rec.expires_at ?? ""),
          has_access_token: typeof rec.access_token_enc === "string" && rec.access_token_enc.trim().length > 0,
          has_refresh_token: typeof rec.refresh_token_enc === "string" && rec.refresh_token_enc.trim().length > 0,
          settings: safeMetaSnapshot(rec.settings),
          meta: safeMetaSnapshot(rec.meta),
        };
      })
      .filter((row) => row.provider || row.source || row.product)
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
      .forEach((row) => pushPart(parts, "integration", row));
  } catch {
    // best effort: the caller will still get a stable fallback signature
  }


  try {
    const { data } = await supabase
      .from("profiles")
      .select("inrcy_site_ownership,lead_conversion_rate,avg_basket")
      .eq("user_id", userId)
      .maybeSingle();
    const rec = asRecord(data);
    pushPart(parts, "profile", {
      inrcy_site_ownership: String(rec.inrcy_site_ownership ?? "none"),
      lead_conversion_rate: Number(rec.lead_conversion_rate ?? 0),
      avg_basket: Number(rec.avg_basket ?? 0),
    });
  } catch {}

  try {
    const { data } = await supabase
      .from("inrcy_site_configs")
      .select("site_url,settings")
      .eq("user_id", userId)
      .maybeSingle();
    const rec = asRecord(data);
    pushPart(parts, "site_inrcy", {
      site_url: String(rec.site_url ?? ""),
      settings: rec.settings ?? {},
    });
  } catch {}

  try {
    const { data } = await supabase
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();
    pushPart(parts, "pro_tools", asRecord(data).settings ?? {});
  } catch {}

  try {
    const { data } = await supabase
      .from("business_profiles")
      .select("sector")
      .eq("user_id", userId)
      .maybeSingle();
    pushPart(parts, "business", { sector: String(asRecord(data).sector ?? "") });
  } catch {}

  const raw = parts.join("|") || "none";
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}
