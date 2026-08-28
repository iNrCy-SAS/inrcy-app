"use client";

import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { createClient } from "@/lib/supabaseClient";

export type MobileShortcutId =
  | "agent"
  | "inrsend"
  | "crm"
  | "calendar"
  | "stats"
  | "cash"
  | "propulser"
  | "fideliser"
  | "reputation";

export type MobileShortcutOption = {
  id: MobileShortcutId;
  href: string;
  iconSrc?: string;
  iconText?: string;
};

export const MOBILE_SHORTCUT_MAX = 6;
export const MOBILE_SHORTCUTS_EVENT = "inrcy:mobile-shortcuts-updated";

export const DEFAULT_MOBILE_SHORTCUTS: readonly MobileShortcutId[] = [
  "agent",
  "inrsend",
  "crm",
  "calendar",
  "stats",
  "cash",
];

export const MOBILE_SHORTCUT_OPTIONS: readonly MobileShortcutOption[] = [
  { id: "agent", href: "/dashboard/agent", iconSrc: "/mobile-shortcuts/optimized/inragent-shortcut.png" },
  { id: "inrsend", href: "/dashboard/mails", iconSrc: "/mobile-shortcuts/optimized/inrsend-shortcut.png" },
  { id: "crm", href: "/dashboard/crm", iconSrc: "/mobile-shortcuts/optimized/inrcrm-shortcut.png" },
  { id: "calendar", href: "/dashboard/agenda", iconSrc: "/mobile-shortcuts/optimized/inrcalendar-shortcut.png" },
  { id: "stats", href: "/dashboard/stats", iconSrc: "/mobile-shortcuts/optimized/inrstats-shortcut.png" },
  { id: "cash", href: "/dashboard?action=cash", iconSrc: "/mobile-shortcuts/optimized/encaisser-shortcut.png" },
  { id: "propulser", href: "/dashboard/propulser", iconSrc: "/mobile-shortcuts/optimized/propulser-shortcut.png" },
  { id: "fideliser", href: "/dashboard/fideliser", iconSrc: "/mobile-shortcuts/optimized/fideliser-shortcut.png" },
  { id: "reputation", href: "/dashboard/e-reputation", iconSrc: "/mobile-shortcuts/optimized/reputation-shortcut.png" },
] as const;

const ALLOWED_IDS = new Set<MobileShortcutId>(MOBILE_SHORTCUT_OPTIONS.map((option) => option.id));
const LOCAL_STORAGE_PREFIX = "inrcy_mobile_shortcuts_v1";
const REMOTE_TABLE = "inrcy_mobile_shortcut_preferences";

export function normalizeMobileShortcuts(input: unknown): MobileShortcutId[] {
  if (!Array.isArray(input)) return [...DEFAULT_MOBILE_SHORTCUTS];
  const unique: MobileShortcutId[] = [];
  for (const value of input) {
    const id = String(value || "") as MobileShortcutId;
    if (!ALLOWED_IDS.has(id) || unique.includes(id)) continue;
    unique.push(id);
    if (unique.length >= MOBILE_SHORTCUT_MAX) break;
  }
  return unique.length > 0 ? unique : [...DEFAULT_MOBILE_SHORTCUTS];
}

export function getMobileShortcutOption(id: MobileShortcutId): MobileShortcutOption {
  return MOBILE_SHORTCUT_OPTIONS.find((option) => option.id === id) || MOBILE_SHORTCUT_OPTIONS[0];
}

export function getMobileShortcutLabel(id: MobileShortcutId, locale = "fr-FR"): string {
  const language = String(locale || "fr").slice(0, 2).toLowerCase();
  const labels: Record<string, Partial<Record<MobileShortcutId, string>>> = {
    fr: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Encaisser", propulser: "Propulser", fideliser: "Fidéliser", reputation: "E-réputation" },
    en: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Payments", propulser: "Grow", fideliser: "Loyalty", reputation: "E-reputation" },
    es: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Cobrar", propulser: "Impulsar", fideliser: "Fidelizar", reputation: "E-reputación" },
    it: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Incassare", propulser: "Crescita", fideliser: "Fidelizzare", reputation: "E-reputazione" },
    de: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Kassieren", propulser: "Wachstum", fideliser: "Bindung", reputation: "E-Reputation" },
    pt: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Receber", propulser: "Impulsionar", fideliser: "Fidelizar", reputation: "E-reputação" },
    th: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "รับชำระเงิน", propulser: "เติบโต", fideliser: "สร้างความภักดี", reputation: "ชื่อเสียงออนไลน์" },
    zh: { agent: "iNrAgent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "收款", propulser: "增长", fideliser: "客户忠诚", reputation: "在线口碑" },
  };
  return labels[language]?.[id] || labels.fr[id] || id;
}

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
