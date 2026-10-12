import "server-only";

import { NextResponse } from "next/server";
import { ADMIN_USER_IDS, getMyRole } from "@/lib/roles";
import { META_DIRECT_CHANNELS_PUBLIC_ENABLED } from "@/lib/metaChannelRollout";

type SupabaseLike = { from: (...args: any[]) => any };

/** Account checks also protect cron jobs, shared links and cached projections. */
export async function isMetaChannelPilotEnabledForAccount(
  supabase: SupabaseLike,
  accountId: string,
): Promise<boolean> {
  if (META_DIRECT_CHANNELS_PUBLIC_ENABLED) return true;
  if (ADMIN_USER_IDS.some((id) => id === accountId)) return true;
  const { data, error } = await supabase.from("profiles").select("role").eq("user_id", accountId).maybeSingle();
  if (error) return false;
  return data?.role === "admin";
}

export async function isMetaChannelPilotEnabledForActorAndAccount(
  supabase: SupabaseLike,
  accountId: string,
): Promise<boolean> {
  if (META_DIRECT_CHANNELS_PUBLIC_ENABLED) return true;
  const [{ isAdmin }, accountAllowed] = await Promise.all([
    getMyRole(), isMetaChannelPilotEnabledForAccount(supabase, accountId),
  ]);
  return isAdmin && accountAllowed;
}

export function metaChannelPilotDeniedResponse() {
  return NextResponse.json({
    ok: false,
    error: "Ce canal est réservé aux comptes ADMIN pendant sa validation.",
    code: "meta_channel_admin_pilot",
  }, { status: 403 });
}
