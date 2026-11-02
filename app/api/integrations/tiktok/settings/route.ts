import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildTiktokSettingsPatch,
  normalizeTiktokCommercialContent,
  normalizeTiktokPreferredMedia,
  normalizeTiktokProfileUrl,
} from "@/lib/tiktokSettings";
import { readTiktokSettings, readTiktokSettingsWithOAuth, saveTiktokSettings } from "@/lib/tiktokRouteStorage";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET() {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { tiktok } = await readTiktokSettingsWithOAuth(supabaseAdmin, activeUserId);
  return NextResponse.json({ ok: true, tiktok });
}

export async function POST(request: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await request.json().catch(() => ({}));
  const payload = asRecord(body);
  const defaultsPayload = asRecord(payload.defaults);

  const { root, tiktok: current } = await readTiktokSettings(supabase, activeUserId);
  const patch: any = {};

  if (typeof payload.profileUrl === "string") {
    const normalized = normalizeTiktokProfileUrl(payload.profileUrl);
    if (!normalized.ok) {
      return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
    }
    patch.profileUrl = normalized.url;
  }

  if (typeof payload.username === "string") {
    patch.username = payload.username.trim() || current.username;
  }

  const defaultPatch: Record<string, unknown> = {};
  if ("preferredMedia" in defaultsPayload) defaultPatch.preferredMedia = normalizeTiktokPreferredMedia(defaultsPayload.preferredMedia);
  if ("allowComments" in defaultsPayload) defaultPatch.allowComments = Boolean(defaultsPayload.allowComments);
  if ("allowDuo" in defaultsPayload) defaultPatch.allowDuo = Boolean(defaultsPayload.allowDuo);
  if ("allowStitch" in defaultsPayload) defaultPatch.allowStitch = Boolean(defaultsPayload.allowStitch);
  if ("photoAutoMusic" in defaultsPayload) defaultPatch.photoAutoMusic = Boolean(defaultsPayload.photoAutoMusic);
  if ("commercialContent" in defaultsPayload) defaultPatch.commercialContent = normalizeTiktokCommercialContent(defaultsPayload.commercialContent);
  if ("aiContent" in defaultsPayload) defaultPatch.aiContent = Boolean(defaultsPayload.aiContent);
  if (Object.keys(defaultPatch).length) patch.defaults = defaultPatch;

  const next = buildTiktokSettingsPatch(current, patch);
  await saveTiktokSettings(supabaseAdmin, activeUserId, root, next);
  const refreshed = await readTiktokSettingsWithOAuth(supabaseAdmin, activeUserId);

  return NextResponse.json({ ok: true, tiktok: refreshed.tiktok });
}
