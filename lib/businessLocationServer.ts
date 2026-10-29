import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { invalidateBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { collectBusinessDnaChannelSources } from "@/lib/businessDnaChannelAnalysis";
import {
  buildMissingBusinessLocationPatch,
  normalizeBusinessLocation,
  resolveBusinessLocationCandidate,
  resolveBusinessIdentitySuggestions,
  type BusinessLocation,
  type BusinessLocationSource,
} from "@/lib/businessLocationAutofill";
import { revalidateInrSearchPublicRoutes } from "@/lib/inrSearchProvisioning";
import { isMetaChannelPilotEnabledForActorAndAccount } from "@/lib/metaChannelRolloutServer";
import { resolveProfessionalCompanyNameFromProfile } from "@/lib/professionalBusinessIdentity";
import { asRecord, asString } from "@/lib/tsSafe";

type LocationDatabase = Pick<SupabaseClient, "from">;
type StoredLocation = {
  exists: boolean;
  location: BusinessLocation;
  rawPostalCode: string | null;
  rawCity: string | null;
};

async function readStoredLocation(supabase: LocationDatabase, accountId: string): Promise<StoredLocation> {
  if (!accountId) throw new Error("Compte actif requis.");
  const { data, error } = await supabase.from("profiles").select("hq_zip,hq_city")
    .eq("user_id", accountId).maybeSingle();
  if (error) throw error;
  return {
    exists: Boolean(data),
    location: normalizeBusinessLocation({ postalCode: data?.hq_zip, city: data?.hq_city }),
    rawPostalCode: typeof data?.hq_zip === "string" ? data.hq_zip : null,
    rawCity: typeof data?.hq_city === "string" ? data.hq_city : null,
  };
}

export async function readBusinessLocation(supabase: LocationDatabase, accountId: string) {
  return (await readStoredLocation(supabase, accountId)).location;
}

async function invalidateLocationDependents(supabase: LocationDatabase, accountId: string) {
  await invalidateBoosterGenerationContext(accountId, "professional");
  const tools = await supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle();
  if (tools.error) throw tools.error;
  const slug = asString(asRecord(asRecord(tools.data?.settings).inrSearch).slug) || "";
  revalidateInrSearchPublicRoutes(slug);
  revalidatePath("/annuaire");
}

async function invalidateAfterSave(supabase: LocationDatabase, accountId: string) {
  // A cache outage must not report an already committed edit as a failed save.
  try { await invalidateLocationDependents(supabase, accountId); }
  catch { console.warn("[business-location] dependent cache refresh unavailable", { accountId }); }
}

export async function saveBusinessLocation(supabase: LocationDatabase, accountId: string, location: BusinessLocation) {
  const stored = await readStoredLocation(supabase, accountId);
  if (stored.location.postalCode === location.postalCode && stored.location.city === location.city) return stored.location;
  const fields = { hq_zip: location.postalCode, hq_city: location.city };
  const query = stored.exists
    ? supabase.from("profiles").update(fields).eq("user_id", accountId)
    : supabase.from("profiles").insert({ user_id: accountId, ...fields });
  const { data, error } = await query.select("hq_zip,hq_city").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Le lieu d’implantation n’a pas pu être enregistré.");
  await invalidateAfterSave(supabase, accountId);
  return normalizeBusinessLocation({ postalCode: data.hq_zip, city: data.hq_city });
}

export async function autofillBusinessLocationFromSources(args: {
  supabase: LocationDatabase;
  accountId: string;
  sources: BusinessLocationSource[];
  expectedLocation?: { postalCode: unknown; city: unknown };
}) {
  const { supabase, accountId, sources } = args;
  const stored = await readStoredLocation(supabase, accountId);
  if (args.expectedLocation) {
    const expectedZip = typeof args.expectedLocation.postalCode === "string" ? args.expectedLocation.postalCode : null;
    const expectedCity = typeof args.expectedLocation.city === "string" ? args.expectedLocation.city : null;
    if (expectedZip !== stored.rawPostalCode || expectedCity !== stored.rawCity) return { location: stored.location, changed: false };
  }
  const proposed = resolveBusinessLocationCandidate(sources);
  const patch = buildMissingBusinessLocationPatch(stored.location, proposed);
  if (!patch || !proposed || !stored.exists) return { location: stored.location, changed: false };
  const fields = {
    ...(patch.postalCode !== undefined ? { hq_zip: patch.postalCode } : {}),
    ...(patch.city !== undefined ? { hq_city: patch.city } : {}),
  };
  let query = supabase.from("profiles").update(fields).eq("user_id", accountId);
  // Compare both original fields: a manual edit made while collecting channels
  // wins over autofill, even if it changed the other member of the pair.
  query = stored.rawPostalCode === null ? query.is("hq_zip", null) : query.eq("hq_zip", stored.rawPostalCode);
  query = stored.rawCity === null ? query.is("hq_city", null) : query.eq("hq_city", stored.rawCity);
  const { data, error } = await query.select("hq_zip,hq_city").maybeSingle();
  if (error) throw error;
  if (!data) return { location: await readBusinessLocation(supabase, accountId), changed: false };
  await invalidateAfterSave(supabase, accountId);
  return {
    location: normalizeBusinessLocation({ postalCode: data.hq_zip, city: data.hq_city }),
    changed: true,
    source: proposed.source,
  };
}

export async function autofillBusinessLocation(args: { supabase: LocationDatabase; accountId: string }) {
  const { supabase, accountId } = args;
  const initial = await readStoredLocation(supabase, accountId);
  const current = initial.location;
  if (current.postalCode && current.city) return { location: current, changed: false };
  const [profileResult, businessResult, toolsResult, metaPilotEnabled] = await Promise.all([
    supabase.from("profiles").select("company_legal_name").eq("user_id", accountId).maybeSingle(),
    supabase.from("business_profiles").select("*").eq("user_id", accountId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle(),
    isMetaChannelPilotEnabledForActorAndAccount(supabase, accountId),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (businessResult.error) throw businessResult.error;
  if (toolsResult.error) throw toolsResult.error;
  const profile = asRecord(profileResult.data);
  const business = asRecord(businessResult.data);
  const sources = await collectBusinessDnaChannelSources({
    supabase, userId: accountId, metaPilotEnabled,
    businessProfile: businessResult.data, proToolsConfig: toolsResult.data,
    companyName: resolveProfessionalCompanyNameFromProfile(
      profile.company_legal_name, business.company_legal_name, business.company_name, business.business_name,
    ),
  });
  return autofillBusinessLocationFromSources({ supabase, accountId, sources, expectedLocation: {
    postalCode: initial.rawPostalCode, city: initial.rawCity,
  } });
}

export async function autofillBusinessIdentityFromSources(args: {
  supabase: LocationDatabase;
  accountId: string;
  sources: BusinessLocationSource[];
  expectedProfile?: Record<string, unknown>;
}) {
  const { supabase, accountId } = args;
  if (!accountId) throw new Error("Compte actif requis.");
  const proposed = resolveBusinessIdentitySuggestions(args.sources);
  if (!Object.keys(proposed).length) return { changed: false };
  const fields = ["company_legal_name", "phone", "contact_email"] as const;
  const { data, error } = await supabase.from("profiles").select(fields.join(",")).eq("user_id", accountId).maybeSingle();
  if (error) throw error;
  if (!data) return { changed: false };
  const profile = asRecord(data);
  const patch: Partial<Record<typeof fields[number], string>> = {};
  for (const field of fields) {
    if (typeof profile[field] === "string" && profile[field].trim()) continue;
    if (!proposed[field]) continue;
    // A field cleared or changed by hand while channels were read stays manual.
    if (args.expectedProfile && (args.expectedProfile[field] ?? null) !== (profile[field] ?? null)) continue;
    patch[field] = proposed[field].value;
  }
  if (!Object.keys(patch).length) return { changed: false };
  let query = supabase.from("profiles").update(patch).eq("user_id", accountId);
  for (const field of Object.keys(patch) as Array<typeof fields[number]>) {
    query = profile[field] == null ? query.is(field, null) : query.eq(field, profile[field]);
  }
  const saved = await query.select(fields.join(",")).maybeSingle();
  if (saved.error) throw saved.error;
  if (!saved.data) return { changed: false };
  await invalidateAfterSave(supabase, accountId);
  return { changed: true };
}
