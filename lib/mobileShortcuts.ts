"use client";

import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { createClient } from "@/lib/supabaseClient";
import { DEFAULT_MOBILE_SHORTCUTS, MOBILE_SHORTCUTS_EVENT, normalizeMobileShortcuts, type MobileShortcutId } from "./mobileShortcutPolicy";
export * from "./mobileShortcutPolicy";

const LOCAL_STORAGE_PREFIX = "inrcy_mobile_shortcuts_v1";
const REMOTE_TABLE = "inrcy_mobile_shortcut_preferences";
function storageKey(authUserId: string, accountId: string): string {
  return `${LOCAL_STORAGE_PREFIX}:${authUserId}:${accountId}`;
}

function readLocal(authUserId: string, accountId: string): MobileShortcutId[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(authUserId, accountId));
    if (!raw) return null;
    return normalizeMobileShortcuts(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(authUserId: string, accountId: string, shortcuts: readonly MobileShortcutId[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(authUserId, accountId), JSON.stringify(shortcuts));
  } catch {}
}

export async function loadMobileShortcutsPreference(): Promise<MobileShortcutId[]> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return [...DEFAULT_MOBILE_SHORTCUTS];

  const accountId = resolveActiveBrowserUserId(user.id);
  const local = readLocal(user.id, accountId);

  try {
    const { data: row, error } = await supabase
      .from(REMOTE_TABLE)
      .select("shortcuts, updated_at")
      .eq("auth_user_id", user.id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (!error && row) {
      const remote = normalizeMobileShortcuts((row as { shortcuts?: unknown }).shortcuts);
      writeLocal(user.id, accountId, remote);
      return remote;
    }
  } catch {
    // La préférence locale reste utilisable même avant déploiement de la table SQL.
  }

  return local || [...DEFAULT_MOBILE_SHORTCUTS];
}

export async function saveMobileShortcutsPreference(input: readonly MobileShortcutId[]): Promise<MobileShortcutId[]> {
  const shortcuts = normalizeMobileShortcuts(input);
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return shortcuts;

  const accountId = resolveActiveBrowserUserId(user.id);
  writeLocal(user.id, accountId, shortcuts);

  try {
    await supabase.from(REMOTE_TABLE).upsert(
      {
        auth_user_id: user.id,
        account_id: accountId,
        shortcuts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "auth_user_id,account_id" },
    );
  } catch {
    // Fallback local volontaire : aucun réglage ne doit casser Préférences générales.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MOBILE_SHORTCUTS_EVENT, { detail: { shortcuts } }));
  }
  return shortcuts;
}
