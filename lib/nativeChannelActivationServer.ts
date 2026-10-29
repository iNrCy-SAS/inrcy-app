import "server-only";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "./supabaseAdmin";
import { getNativeChannelPublicationEligibility } from "./inrSearchEligibility";
import { ensureSystemManagedInrSearch, revalidateInrSearchPublicRoutes } from "./inrSearchProvisioning";
import { resolveNativeChannelStates, updateNativeChannelActivation, type NativeChannelKey } from "./nativeChannelActivation";
import { createInrBadgePublicUrl } from "./inrBadge";
import { purgeInrSearchDirectoryCache } from "./inrSearchDirectoryCache";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export async function syncNativeChannelsForAccount(accountId: string, mutation?: { key: NativeChannelKey; enabled: boolean }, options?: { profileSaved?: boolean }) {
  if (!accountId) throw new Error("Compte absent.");
  const eligibility = await getNativeChannelPublicationEligibility(accountId);
  const allowed = { inrbadge: eligibility.inrbadge.allowed, inr_search: eligibility.inr_search.allowed, inr_directory: eligibility.inr_directory.allowed };
  if (mutation?.enabled && !allowed[mutation.key]) throw new Error("Ce canal n’est pas disponible pour cet établissement.");
  if (mutation?.key === "inr_search" && mutation.enabled) {
    const provisioned = await ensureSystemManagedInrSearch(supabaseAdmin, accountId);
    if (!provisioned.inrSearch.slug) throw new Error("La page iNrSearch n’a pas pu être préparée. Réessayez.");
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const config = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle();
    if (config.error) throw config.error;
    // Read the foundation after the config snapshot, and again after each CAS
    // conflict: an older request cannot restore a pre-save readiness result.
    const [profileResult, businessResult] = await Promise.all([
      supabaseAdmin.from("profiles").select("company_legal_name,first_name,last_name,phone,contact_email,hq_zip,hq_city").eq("user_id", accountId).maybeSingle(),
      supabaseAdmin.from("business_profiles").select("sector").eq("user_id", accountId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (businessResult.error) throw businessResult.error;
    const previous = record(config.data?.settings);
    const settings: Record<string, unknown> = mutation ? updateNativeChannelActivation(previous, mutation.key, mutation.enabled) : previous;
    const states = resolveNativeChannelStates({ profile: profileResult.data, business: businessResult.data, settings, allowed });
    const search = record(settings.inrSearch);
    const effectiveSearch = search.activationVersion === 1 ? { ...search, enabled: states.inr_search.published, publicationReady: states.inr_search.ready,
      publishedAt: states.inr_search.published ? search.publishedAt || new Date().toISOString() : search.publishedAt || null } : search;
    const nextSettings = search.activationVersion === 1 ? { ...settings, inrSearch: effectiveSearch } : settings;
    const changed = JSON.stringify(previous) !== JSON.stringify(nextSettings);
    if (changed) {
      if (config.data) {
        let update = supabaseAdmin.from("pro_tools_configs").update({ settings: nextSettings }).eq("user_id", accountId);
        update = config.data.settings == null ? update.is("settings", null) : update.eq("settings", JSON.stringify(config.data.settings));
        const saved = await update.select("user_id");
        if (saved.error) throw saved.error;
        if (!saved.data?.length) continue;
      } else {
        const saved = await supabaseAdmin.from("pro_tools_configs").insert({ user_id: accountId, settings: nextSettings });
        if (saved.error?.code === "23505") continue;
        if (saved.error) throw saved.error;
      }
    }
    const profile = record(profileResult.data);
    const badgeUrl = createInrBadgePublicUrl({ userId: accountId, companyLegalName: String(profile.company_legal_name || ""), firstName: String(profile.first_name || ""), lastName: String(profile.last_name || ""), logoUrl: "", phone: String(profile.phone || ""), contactEmail: String(profile.contact_email || "") });
    const slug = String(effectiveSearch.slug || "");
    if (changed || options?.profileSaved) {
      revalidatePath("/annuaire");
      revalidatePath("/badge/[slug]", "page");
      revalidateInrSearchPublicRoutes(slug);
      if (process.env.NODE_ENV === "production") await purgeInrSearchDirectoryCache({ reason: "profile_updated", slug }).catch(() => undefined);
    }
    return { ok: true as const, accountId, states, companyName: String(profile.company_legal_name || ""), badgeUrl: states.inrbadge.published ? badgeUrl : "", searchSlug: slug, changed };
  }
  throw new Error("Votre compte a été actualisé pendant l’enregistrement. Réessayez.");
}
