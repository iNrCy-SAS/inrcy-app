import { NextResponse } from "next/server";

import {
  isEditableChannelPublicUrlChannel,
  normalizeChannelPublicUrl,
  type EditableChannelPublicUrlChannel,
  type LinkedinPublicUrlTarget,
} from "@/lib/channelPublicUrl";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { hasActiveInrcySite } from "@/lib/inrcySite";
import { log } from "@/lib/observability/logger";
import { requireUser } from "@/lib/requireUser";
import { syncSitePresenceIntegrations } from "@/lib/sitePresenceSync";
import { clearAllToolCaches } from "@/lib/statsCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord, asString } from "@/lib/tsSafe";

type IntegrationUrlMapping = {
  provider: string;
  source: string;
  product: string;
  metaKey: string;
};

export const CHANNEL_PUBLIC_URL_INTEGRATION_MAPPINGS: Partial<
  Record<EditableChannelPublicUrlChannel, IntegrationUrlMapping>
> = {
  gmb: { provider: "google", source: "gmb", product: "gmb", metaKey: "url" },
  facebook: { provider: "facebook", source: "facebook", product: "facebook", metaKey: "page_url" },
  instagram: { provider: "instagram", source: "instagram", product: "instagram", metaKey: "profile_url" },
  linkedin: { provider: "linkedin", source: "linkedin", product: "linkedin", metaKey: "profile_url" },
  tiktok: { provider: "tiktok", source: "tiktok", product: "tiktok", metaKey: "profile_url" },
  youtube_shorts: { provider: "youtube", source: "youtube_shorts", product: "youtube_shorts", metaKey: "channel_url" },
  pinterest: { provider: "pinterest", source: "pinterest", product: "pinterest", metaKey: "profile_url" },
  x: { provider: "x", source: "x", product: "x", metaKey: "profile_url" },
};

function updateChannelSettings(
  root: Record<string, unknown>,
  channel: Exclude<EditableChannelPublicUrlChannel, "site_inrcy">,
  url: string,
  target: LinkedinPublicUrlTarget,
) {
  const next = { ...root };

  if (channel === "site_web") {
    const current = asRecord(root.site_web);
    next.site_web = { ...current, url, domain: new URL(url).hostname };
    return next;
  }

  const current = asRecord(root[channel]);
  switch (channel) {
    case "gmb":
    case "facebook":
    case "instagram":
      next[channel] = { ...current, url };
      break;
    case "linkedin": {
      const organizationSelected = Boolean(asString(current.orgId));
      next.linkedin = target === "organization"
        ? { ...current, orgUrl: url, ...(organizationSelected ? { url } : {}) }
        : { ...current, profileUrl: url, ...(!organizationSelected ? { url } : {}) };
      break;
    }
    case "tiktok":
      next.tiktok = { ...current, profileUrl: url };
      break;
    case "youtube_shorts":
      next.youtube_shorts = { ...current, channelUrl: url };
      break;
    case "pinterest":
      next.pinterest = { ...current, publicProfileUrl: url, profileUrl: url };
      break;
    case "x":
      next.x = { ...current, profileUrl: url, url };
      break;
  }

  return next;
}

async function updateIntegrationSourceOfTruth(
  userId: string,
  channel: Exclude<EditableChannelPublicUrlChannel, "site_inrcy" | "site_web">,
  url: string,
  target: LinkedinPublicUrlTarget,
) {
  const mapping = CHANNEL_PUBLIC_URL_INTEGRATION_MAPPINGS[channel];
  if (!mapping) throw new Error("Canal non pris en charge.");

  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id,meta")
    .eq("user_id", userId)
    .eq("provider", mapping.provider)
    .eq("source", mapping.source)
    .eq("product", mapping.product)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const integration = asRecord(data);
  const integrationId = asString(integration.id);
  // A public link may be prepared before OAuth. Once an integration exists,
  // its metadata is updated too so a refresh cannot restore an auto-detected
  // value over the professional's correction.
  if (!integrationId) return false;

  const metaKey = channel === "linkedin" && target === "organization"
    ? "org_url"
    : mapping.metaKey;
  const nextMeta = { ...asRecord(integration.meta), [metaKey]: url };
  const { data: updatedIntegration, error: updateError } = await supabaseAdmin
    .from("integrations")
    .update({ meta: nextMeta, updated_at: new Date().toISOString() })
    .eq("id", integrationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  return asString(asRecord(updatedIntegration).id) === integrationId;
}

export async function PATCH(request: Request) {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    const raw = await request.json().catch(() => null);
    const body = asRecord(raw);
    const channel = body.channel;
    if (!isEditableChannelPublicUrlChannel(channel)) {
      return NextResponse.json(
        { ok: false, error: "Canal invalide.", errorCode: "invalid_channel" },
        { status: 400 },
      );
    }

    const target: LinkedinPublicUrlTarget = body.target === "organization"
      ? "organization"
      : "profile";
    const normalized = normalizeChannelPublicUrl(channel, body.url, target);
    if (!normalized.ok) {
      return NextResponse.json(
        { ok: false, error: "Le lien public est invalide pour ce canal.", errorCode: normalized.code },
        { status: 400 },
      );
    }

    let mirrorSynced = true;
    if (channel === "site_inrcy") {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("inrcy_site_ownership")
        .eq("user_id", activeUserId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!hasActiveInrcySite(asString(asRecord(profile).inrcy_site_ownership))) {
        return NextResponse.json(
          { ok: false, error: "Aucun site iNrCy actif n’est associé à ce compte.", errorCode: "site_ownership_required" },
          { status: 403 },
        );
      }

      const { error } = await supabaseAdmin
        .from("inrcy_site_configs")
        .upsert(
          { user_id: activeUserId, site_url: normalized.url },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    } else {
      let sourceOfTruthUpdated = false;
      if (channel !== "site_web") {
        sourceOfTruthUpdated = await updateIntegrationSourceOfTruth(activeUserId, channel, normalized.url, target);
      }

      try {
        const { data: currentConfig, error: readError } = await supabaseAdmin
          .from("pro_tools_configs")
          .select("settings")
          .eq("user_id", activeUserId)
          .maybeSingle();
        if (readError) throw readError;

        const root = asRecord(asRecord(currentConfig).settings);
        const settings = updateChannelSettings(root, channel, normalized.url, target);
        const { error: writeError } = await supabaseAdmin
          .from("pro_tools_configs")
          .upsert({ user_id: activeUserId, settings }, { onConflict: "user_id" });
        if (writeError) throw writeError;
      } catch (mirrorError) {
        // Once provider metadata (the canonical source for connected social
        // channels) is committed, reporting a 500 would invite a misleading
        // retry even though the requested URL is already active. The mirror is
        // still mandatory when no provider row exists and for site_web, where
        // pro_tools_configs is itself the source of truth.
        if (!sourceOfTruthUpdated) throw mirrorError;
        mirrorSynced = false;
        log.warn("channel_public_url_mirror_sync_failed", {
          user_id: activeUserId,
          channel,
          error: mirrorError instanceof Error ? mirrorError.message : String(mirrorError || ""),
        });
      }
    }

    if (channel === "site_inrcy" || channel === "site_web") {
      try {
        await syncSitePresenceIntegrations(activeUserId);
      } catch (syncError) {
        log.warn("channel_public_url_site_presence_sync_failed", {
          user_id: activeUserId,
          channel,
          error: syncError instanceof Error ? syncError.message : String(syncError || ""),
        });
      }
    }

    await clearAllToolCaches(supabase, activeUserId);
    return NextResponse.json({ ok: true, url: normalized.url, mirrorSynced });
  } catch (error) {
    const status = Number(asRecord(error).status) || 500;
    return jsonUserFacingError(error, {
      status,
      fallback: "Impossible d’enregistrer ce lien pour le moment.",
    });
  }
}
