import "server-only";

import type { requireUser } from "./requireUser";
import { normalizeInrSearchDisplaySettings, normalizeInrSearchSections, DEFAULT_INR_SEARCH_DISPLAY_SETTINGS, DEFAULT_INR_SEARCH_SECTIONS } from "./inrSearchDisplaySettings";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function validateInrSearchPresentationPatch(body: Record<string, unknown>) {
  for (const [field, defaults] of [["display", DEFAULT_INR_SEARCH_DISPLAY_SETTINGS], ["sections", DEFAULT_INR_SEARCH_SECTIONS]] as const) {
    if (body[field] === undefined) continue;
    const value = body[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (Object.entries(value).some(([key, enabled]) => !Object.hasOwn(defaults, key) || typeof enabled !== "boolean")) return false;
  }
  for (const [key, limit] of [["pageTitleOverride", 160], ["pageDescriptionOverride", 500]] as const) {
    if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > limit)) return false;
  }
  return true;
}

export async function saveInrSearchPresentationSettings(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  accountId: string,
  patch: Record<string, unknown>,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle();
    if (current.error) throw current.error;
    const root = record(current.data?.settings);
    const previous = record(root.inrSearch);
    const inrSearch: Record<string, unknown> = {
      ...previous,
      display: normalizeInrSearchDisplaySettings({ ...normalizeInrSearchDisplaySettings(previous.display), ...record(patch.display) }),
      sections: normalizeInrSearchSections({ ...normalizeInrSearchSections(previous.sections), ...record(patch.sections) }),
      ...(typeof patch.pageTitleOverride === "string" ? { pageTitleOverride: patch.pageTitleOverride.trim() } : {}),
      ...(typeof patch.pageDescriptionOverride === "string" ? { pageDescriptionOverride: patch.pageDescriptionOverride.trim() } : {}),
      updatedAt: new Date().toISOString(),
    };
    const settings = { ...root, inrSearch };
    if (current.data) {
      let query = supabase.from("pro_tools_configs").update({ settings }).eq("user_id", accountId);
      query = current.data.settings == null ? query.is("settings", null) : query.eq("settings", JSON.stringify(current.data.settings));
      const saved = await query.select("user_id");
      if (saved.error) throw saved.error;
      if (saved.data?.length) return inrSearch;
    } else {
      const saved = await supabase.from("pro_tools_configs").insert({ user_id: accountId, settings });
      if (!saved.error) return inrSearch;
      if (saved.error.code !== "23505") throw saved.error;
    }
  }
  throw new Error("Votre établissement a été modifié pendant l’enregistrement. Rechargez les réglages puis réessayez.");
}
