import "server-only";

import { NextResponse } from "next/server";

import {
  buildBubbleAccessMap,
  isBubbleEnabled,
  type AppBubbleAccessMap,
  type AppBubbleKey,
} from "@/lib/bubbleAccess";

// Keep this type intentionally shallow.
// Passing the generated Supabase client through a deep structural type can make
// TypeScript expand very large conditional/generic types during Next builds.
type SupabaseLike = {
  from: (...args: any[]) => any;
};

export const APP_BUBBLE_ACCESS_DISABLED_MESSAGE = "Ce canal est désactivé dans Bubble Access.";

export async function getAppBubbleAccessMapForUser(
  supabase: SupabaseLike,
  userId: string,
): Promise<AppBubbleAccessMap> {
  const { data, error } = await supabase
    .from("app_bubble_access")
    .select("bubble_key,enabled")
    .eq("user_id", userId);

  // Fail closed: a transient database error must never make a disabled channel
  // publishable by falling back to the default access map.
  if (error) throw error;

  return buildBubbleAccessMap(Array.isArray(data) ? data : []);
}

export async function isAppBubbleEnabledForUser(
  supabase: SupabaseLike,
  userId: string,
  bubbleKey: AppBubbleKey,
): Promise<boolean> {
  const accessMap = await getAppBubbleAccessMapForUser(supabase, userId);
  return isBubbleEnabled(accessMap, bubbleKey);
}

export function bubbleAccessDisabledResponse(label: string) {
  const message = `${label} est désactivé dans Bubble Access.`;
  return NextResponse.json(
    {
      ok: false,
      error: message,
      user_message: message,
      code: "bubble_access_disabled",
    },
    { status: 403 },
  );
}
