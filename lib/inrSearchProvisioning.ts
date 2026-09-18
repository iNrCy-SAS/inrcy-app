import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";

import { getInrSearchPublicPageCacheTag } from "@/lib/inrSearchPublic";
import { buildInrSearchIndexingUrls, submitInrSearchUrlsToIndexNow } from "@/lib/inrSearchSeo";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord } from "@/lib/tsSafe";
import {
  resolveProfessionalCompanyNameFromProfile,
  sanitizeProfessionalIdentityText,
} from "@/lib/professionalBusinessIdentity";

const DEFAULT_SECTIONS = {
  identity: true,
  presentation: true,
  contact: true,
  hours: true,
  services: true,
  sectors: true,
  areas: true,
  media: true,
  news: true,
  socials: true,
  faq: true,
  trust: true,
  cta: true,
} as const;

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max).trim();
}

function normalizeSlug(value: unknown) {
  return clean(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function slugAlreadyUsed(slug: string, currentUserId: string) {
  if (!slug) return false;

  const direct = await supabaseAdmin
    .from("pro_tools_configs")
    .select("user_id,settings")
    .contains("settings", { inrSearch: { slug } })
    .neq("user_id", currentUserId)
    .limit(1);

  if (!direct.error) return Array.isArray(direct.data) && direct.data.length > 0;

  const fallback = await supabaseAdmin
    .from("pro_tools_configs")
    .select("user_id,settings")
    .neq("user_id", currentUserId)
    .limit(2000);

  if (fallback.error || !Array.isArray(fallback.data)) return false;
  return fallback.data.some((row: unknown) => {
    const record = asRecord(row);
    const settings = asRecord(record.settings);
    const inrSearch = asRecord(settings.inrSearch);
    return normalizeSlug(inrSearch.slug) === slug;
  });
}

function sameSections(value: unknown) {
  const sections = asRecord(value);
  return Object.entries(DEFAULT_SECTIONS).every(([key, expected]) => sections[key] === expected);
}

export function revalidateInrSearchPublicRoutes(slug = "") {
  revalidatePath("/api/public/inrsearch/directory");
  revalidatePath("/entreprises");
  revalidatePath("/entreprises/[slug]", "page");
  if (slug) {
    revalidatePath(`/entreprises/${slug}`);
    revalidateTag(getInrSearchPublicPageCacheTag(slug), "max");
  }
  revalidatePath("/metiers");
  revalidatePath("/metiers/[metier]", "page");
  revalidatePath("/metiers/[metier]/[ville]", "page");
  revalidatePath("/secteurs");
  revalidatePath("/secteurs/[secteur]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/robots.txt");
}

/**
 * Notifie les moteurs après une modification éditoriale réelle.
 * IndexNow accélère la découverte ; il ne remplace pas la qualité de la page.
 */
export async function notifyInrSearchIndexing(slug = "") {
  if (!slug) return { ok: true, submitted: 0, status: 204 };
  const urls = await buildInrSearchIndexingUrls(slug);
  return submitInrSearchUrlsToIndexNow(urls);
}

export async function ensureSystemManagedInrSearch(
  supabase: any,
  activeUserId: string,
) {
  const membershipRes = await supabase
    .from("inrcy_account_members")
    .select("auth_user_id,is_default,created_at")
    .eq("account_id", activeUserId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(5);

  const memberRows = Array.isArray(membershipRes.data) ? membershipRes.data : [];
  const profileOwnerIds = Array.from(new Set([
    activeUserId,
    ...memberRows.map((row: any) => clean(row?.auth_user_id, 120)).filter(Boolean),
  ]));

  const [{ data: configData, error: configError }, profileRes, businessRes] = await Promise.all([
    supabase
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", activeUserId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("*")
      .in("user_id", profileOwnerIds)
      .limit(profileOwnerIds.length),
    supabase
      .from("business_profiles")
      .select("*")
      .eq("user_id", activeUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (configError) throw configError;

  const profileRows = Array.isArray(profileRes.data) ? profileRes.data : [];
  const selectedProfile = profileRows.find((row: any) => clean(row?.user_id, 120) === activeUserId)
    || profileRows.find((row: any) => profileOwnerIds.includes(clean(row?.user_id, 120)))
    || null;
  const profile = asRecord(selectedProfile);
  const business = asRecord(businessRes.data);
  const root = asRecord(asRecord(configData).settings);
  const current = asRecord(root.inrSearch);
  const companyName = resolveProfessionalCompanyNameFromProfile(
    [profile.company_legal_name, profile.company_name],
  );
  const city = clean(profile.hq_city || profile.city, 120);
  const description = clean(sanitizeProfessionalIdentityText(
    business.business_description || business.activity_description,
    companyName,
  ), 320);

  const preservedSlug = normalizeSlug(current.publishedSlug || current.slug);
  let slug = preservedSlug || normalizeSlug([companyName, city].filter(Boolean).join("-"));
  if (!preservedSlug && slug && await slugAlreadyUsed(slug, activeUserId)) {
    const suffix = activeUserId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase();
    slug = normalizeSlug(`${slug}-${suffix}`);
  }

  const canPublish = Boolean(companyName && slug);
  const now = new Date().toISOString();
  // La synchronisation prépare la page, mais ne doit jamais la connecter à la
  // place du professionnel. Les anciennes pages déjà publiées restent actives.
  const wasEnabled = current.enabled === true && Boolean(preservedSlug);
  const pageEnabled = canPublish && current.enabled === true;
  // Compatibilité : les anciennes configurations n'ont pas encore le choix
  // annuaire. Leur présence actuelle doit être conservée sans modifier leur
  // visibilité lors de cette migration.
  const directoryEnabled = pageEnabled && (
    typeof current.directoryEnabled === "boolean"
      ? current.directoryEnabled
      : wasEnabled
  );
  const next = {
    ...current,
    enabled: pageEnabled,
    slug,
    publishedSlug: canPublish ? slug : "",
    directoryEnabled,
    slugLocked: canPublish,
    publishedAt: pageEnabled ? clean(current.publishedAt, 80) || now : null,
    pageTitle: companyName,
    pageDescription: description,
    sections: { ...DEFAULT_SECTIONS },
    systemManaged: true,
    updatedAt: clean(current.updatedAt, 80) || now,
    indexingRequestedAt: pageEnabled ? clean(current.indexingRequestedAt, 80) || now : null,
  };

  const changed =
    current.systemManaged !== true ||
    current.enabled !== next.enabled ||
    current.directoryEnabled !== next.directoryEnabled ||
    normalizeSlug(current.slug) !== slug ||
    clean(current.pageTitle, 160) !== companyName ||
    clean(current.pageDescription, 320) !== description ||
    !sameSections(current.sections);

  if (changed) {
    next.updatedAt = now;
    if (pageEnabled) next.indexingRequestedAt = now;
    await supabaseAdmin
      .from("pro_tools_configs")
      .upsert({ user_id: activeUserId, settings: { ...root, inrSearch: next } }, { onConflict: "user_id" });

    revalidateInrSearchPublicRoutes(slug);
    if (pageEnabled) {
      await notifyInrSearchIndexing(slug);
    }
  } else if (!wasEnabled && pageEnabled) {
    revalidateInrSearchPublicRoutes(slug);
  }

  return { root, inrSearch: next, changed };
}
