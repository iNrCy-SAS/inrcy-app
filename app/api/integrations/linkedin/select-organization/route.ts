import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { asRecord, asString } from "@/lib/tsSafe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";

import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServer>>;

async function invalidateUserStatsCache(
  supabase: SupabaseServerClient,
  userId: string,
) {
  await clearAllToolCaches(supabase, userId);
}

function normalizeCompanyUrl(orgId: string, orgUrl?: string | null) {
  const raw = String(orgUrl || "").trim();
  if (
    raw.startsWith("https://www.linkedin.com/company/") ||
    raw.startsWith("https://linkedin.com/company/")
  )
    return raw;
  return `https://www.linkedin.com/company/${orgId}`;
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user)
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

  const body = await req.json().catch(() => null);
  const mode = String(body?.mode || "");
  const orgId = String(body?.orgId || "").trim();
  const orgName = body?.orgName ? String(body.orgName).trim() : null;
  const orgUrl = body?.orgUrl
    ? normalizeCompanyUrl(orgId, String(body.orgUrl))
    : orgId
      ? normalizeCompanyUrl(orgId)
      : null;

  const { data: currentIntegration, error: currentIntegrationError } = await supabaseAdmin
    .from("integrations")
    .select("id,meta,provider_account_id,display_name,resource_label")
    .eq("user_id", activeUserId)
    .eq("provider", "linkedin")
    .eq("source", "linkedin")
    .eq("product", "linkedin")
    .maybeSingle();

  if (currentIntegrationError) {
    return jsonUserFacingError(currentIntegrationError, {
      status: 500,
      fallback: "Impossible de charger la connexion LinkedIn.",
    });
  }

  const currentRec = asRecord(currentIntegration);
  const integrationId = asString(currentRec["id"]);
  if (!integrationId) {
    return NextResponse.json(
      { error: "La connexion LinkedIn doit être relancée." },
      { status: 409 },
    );
  }
  const currentMeta = asRecord(currentRec["meta"]);
  const providerAccountId = asString(currentRec["provider_account_id"]);
  const profileUrn =
    asString(currentMeta["profile_urn"]) ||
    (providerAccountId ? `urn:li:person:${providerAccountId}` : null);
  const displayName =
    asString(currentMeta["profile_display_name"]) ||
    asString(currentRec["display_name"]) ||
    asString(currentRec["resource_label"]) ||
    null;
  const profileUrl = asString(currentMeta["profile_url"]) || null;

  if (mode === "profile") {
    if (!profileUrn) {
      return NextResponse.json(
        { error: "Le profil LinkedIn connecté est incomplet. Relancez la connexion." },
        { status: 409 },
      );
    }
    let currentLinkedinSettings: unknown = null;
    try {
      const { data } = await supabaseAdmin
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", activeUserId)
        .maybeSingle();
      currentLinkedinSettings = asRecord(asRecord(data)["settings"])["linkedin"];
    } catch {
      currentLinkedinSettings = null;
    }
    const currentLinkedinRec = asRecord(currentLinkedinSettings);
    const resolvedProfileUrl =
      profileUrl ||
      asString(currentLinkedinRec["profileUrl"]) ||
      asString(currentLinkedinRec["profile_url"]) ||
      "";

    const { data: updatedIntegration, error: updateError } = await supabaseAdmin
      .from("integrations")
      .update({
        status: "connected",
        resource_id: profileUrn,
        resource_label: displayName,
        meta: {
          ...currentMeta,
          profile_display_name: displayName,
          profile_url: resolvedProfileUrl || null,
          profile_urn: profileUrn,
          org_urn: null,
          org_id: null,
          org_name: null,
          org_url: null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId)
      .eq("user_id", activeUserId)
      .select("id,status,resource_id")
      .single();

    if (updateError) {
      return jsonUserFacingError(updateError, {
        status: 500,
        fallback: "Impossible d’enregistrer le profil LinkedIn.",
      });
    }
    if (updatedIntegration?.status !== "connected" || updatedIntegration.resource_id !== profileUrn) {
      return NextResponse.json(
        { error: "Le profil LinkedIn n’a pas été enregistré. Réessayez." },
        { status: 500 },
      );
    }

    try {
      const { data: scRow } = await supabaseAdmin
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", activeUserId)
        .maybeSingle();
      const current = asRecord(asRecord(scRow)["settings"]);
      const merged = {
        ...current,
        linkedin: {
          ...asRecord(current["linkedin"]),
          accountConnected: true,
          connected: true,
          displayName,
          url: resolvedProfileUrl,
          profileUrl: resolvedProfileUrl,
          orgId: "",
          orgName: "",
          orgUrl: "",
          shareToPersonalProfile: false,
        },
      };
      await supabaseAdmin
        .from("pro_tools_configs")
        .upsert(
          { user_id: activeUserId, settings: merged },
          { onConflict: "user_id" },
        );
    } catch {}

    await invalidateUserStatsCache(supabase, activeUserId);

    return NextResponse.json({ ok: true, mode: "profile", profileUrl: resolvedProfileUrl });
  }

  if (!orgId)
    return NextResponse.json(
      { error: "Organisation manquante." },
      { status: 400 },
    );

  const orgUrn = `urn:li:organization:${orgId}`;
  const finalOrgName = orgName || orgId;
  const finalOrgUrl = orgUrl || normalizeCompanyUrl(orgId);

  const { data: updatedIntegration, error: updateError } = await supabaseAdmin
    .from("integrations")
    .update({
      status: "connected",
      resource_id: orgId,
      resource_label: finalOrgName,
      meta: {
        ...currentMeta,
        profile_display_name: displayName,
        profile_url: profileUrl,
        profile_urn: profileUrn,
        org_urn: orgUrn,
        org_id: orgId,
        org_name: finalOrgName,
        org_url: finalOrgUrl,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", integrationId)
    .eq("user_id", activeUserId)
    .select("id,status,resource_id")
    .single();

  if (updateError) {
    return jsonUserFacingError(updateError, {
      status: 500,
      fallback: "Impossible d’enregistrer l’organisation LinkedIn.",
    });
  }
  if (updatedIntegration?.status !== "connected" || updatedIntegration.resource_id !== orgId) {
    return NextResponse.json(
      { error: "L’organisation LinkedIn n’a pas été enregistrée. Réessayez." },
      { status: 500 },
    );
  }

  try {
    const { data: scRow } = await supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", activeUserId)
      .maybeSingle();
    const current = asRecord(asRecord(scRow)["settings"]);
    const currentLinkedin = asRecord(current["linkedin"]);
    const merged = {
      ...current,
      linkedin: {
        ...currentLinkedin,
        accountConnected: true,
        connected: true,
        displayName,
        url: finalOrgUrl,
        profileUrl: profileUrl || asString(currentLinkedin["profileUrl"]) || "",
        orgId,
        orgName: finalOrgName,
        orgUrl: finalOrgUrl,
      },
    };
    await supabaseAdmin
      .from("pro_tools_configs")
      .upsert(
        { user_id: activeUserId, settings: merged },
        { onConflict: "user_id" },
      );
  } catch {}

  await invalidateUserStatsCache(supabase, activeUserId);

  return NextResponse.json({
    ok: true,
    mode: "organization",
    organizationId: orgId,
    organizationName: finalOrgName,
    organizationUrl: finalOrgUrl,
    profileUrl: finalOrgUrl,
  });
}
