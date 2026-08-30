import { NextResponse } from "next/server";

import { bubbleAccessDisabledResponse, isAppBubbleEnabledForUser } from "@/lib/appBubbleAccessServer";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { clearAllToolCaches } from "@/lib/statsCache";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { asRecord } from "@/lib/tsSafe";
import { PINTEREST_PRODUCT, PINTEREST_PROVIDER, PINTEREST_SOURCE } from "@/lib/pinterestOAuth";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";

function normalizeSettingsRoot(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST() {
  try {
    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return NextResponse.json({ ok: false, error: "Non authentifié." }, { status: 401 });
    const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

    if (!(await isAppBubbleEnabledForUser(supabase, activeUserId, "pinterest"))) {
      return bubbleAccessDisabledResponse("Pinterest");
    }

    const { data: disconnected, error: disconnectError } = await supabaseAdmin
      .from("integrations")
      .update({
        status: "disconnected",
        display_name: "Compte Pinterest",
        provider_account_id: null,
        resource_id: null,
        resource_label: null,
        access_token_enc: null,
        refresh_token_enc: null,
        expires_at: null,
        meta: withCurrentConnectionVersion("channel:pinterest", {}),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", activeUserId)
      .eq("provider", PINTEREST_PROVIDER)
      .eq("source", PINTEREST_SOURCE)
      .eq("product", PINTEREST_PRODUCT)
      .select("id,status")
      .maybeSingle();

    if (disconnectError) {
      return jsonUserFacingError(disconnectError, {
        status: 500,
        fallback: "Déconnexion Pinterest impossible.",
      });
    }
    if (disconnected && disconnected.status !== "disconnected") {
      return NextResponse.json({ ok: false, error: "Pinterest n’a pas été déconnecté. Réessayez." }, { status: 500 });
    }

    const { data: cfg } = await supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", activeUserId)
      .maybeSingle();
    const root = normalizeSettingsRoot(asRecord(cfg).settings);
    const currentPinterest = normalizeSettingsRoot(root.pinterest);
    const nextPinterest = { ...currentPinterest };
    for (const key of [
      "boards",
      "avatarUrl",
      "websiteUrl",
      "accountType",
      "accountName",
      "displayName",
      "username",
      "profileUrl",
      "url",
      "defaultBoardId",
      "defaultBoardName",
      "boardId",
      "boardName",
      "scopes",
      "expiresAt",
      "connected",
      "accountConnected",
      "mode",
    ]) {
      delete nextPinterest[key];
    }

    await supabaseAdmin
      .from("pro_tools_configs")
      .upsert({ user_id: activeUserId, settings: { ...root, pinterest: nextPinterest } }, { onConflict: "user_id" });

    await clearAllToolCaches(supabase, activeUserId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Déconnexion Pinterest impossible." }, { status: 400 });
  }
}
