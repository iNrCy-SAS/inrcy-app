import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/requireUser";
import { isInrDirectoryEnabled } from "@/lib/inrDirectorySettings";
import { getInrDirectoryPublicationEligibility } from "@/lib/inrSearchEligibility";
import { resolveDirectoryProfession } from "@/lib/inrDirectoryCatalog";
import { createInrBadgePublicUrl } from "@/lib/inrBadge";
import { purgeInrSearchDirectoryCache } from "@/lib/inrSearchDirectoryCache";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { resolveProfessionalCompanyNameFromProfile } from "@/lib/professionalBusinessIdentity";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

type DirectoryConfigRow = { settings: unknown } | null;

async function saveDirectorySetting(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  accountId: string,
  enabled: boolean,
  initial: DirectoryConfigRow,
) {
  let current = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const root = record(current?.settings);
    const settings = { ...root, inrDirectory: { ...record(root.inrDirectory), enabled, updatedAt: new Date().toISOString() } };
    if (current) {
      // A concurrent profile/channel save must not be overwritten by this toggle.
      let update = supabase.from("pro_tools_configs").update({ settings }).eq("user_id", accountId);
      update = current.settings == null ? update.is("settings", null) : update.eq("settings", JSON.stringify(current.settings));
      const saved = await update.select("user_id");
      if (saved.error) throw saved.error;
      if (saved.data?.length) return;
    } else {
      const saved = await supabase.from("pro_tools_configs").insert({ user_id: accountId, settings });
      if (!saved.error) return;
      if (saved.error.code !== "23505") throw saved.error;
    }
    const fresh = await supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle();
    if (fresh.error) throw fresh.error;
    current = fresh.data;
  }
  throw new Error("Votre compte a été actualisé pendant l’enregistrement. Réessayez dans un instant.");
}

async function handle(request?: Request) {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  try {
    const [config, profileResult, businessResult, eligibility] = await Promise.all([
      supabase.from("pro_tools_configs").select("settings").eq("user_id", activeUserId).maybeSingle(),
      supabase.from("profiles").select("company_legal_name,first_name,last_name,hq_city").eq("user_id", activeUserId).maybeSingle(),
      supabase.from("business_profiles").select("sector").eq("user_id", activeUserId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      getInrDirectoryPublicationEligibility(activeUserId),
    ]);
    if (config.error) throw config.error;
    if (profileResult.error) throw profileResult.error;
    if (businessResult.error) throw businessResult.error;
    const root = record(config.data?.settings);
    const profile = record(profileResult.data);
    const trade = resolveDirectoryProfession(String(businessResult.data?.sector || ""));
    const companyName = resolveProfessionalCompanyNameFromProfile(profile.company_legal_name);
    const city = String(profile.hq_city || "").trim();
    const profileReady = Boolean(companyName && city && trade.profession);
    let enabled = isInrDirectoryEnabled(root);
    let warning = "";
    if (request) {
      const body = await request.json().catch(() => null);
      if (typeof body?.enabled !== "boolean") return NextResponse.json({ ok: false, error: "Le choix de visibilité est invalide." }, { status: 400 });
      if (body.accountId !== undefined && body.accountId !== activeUserId) return NextResponse.json({ ok: false, error: "L’établissement actif a changé. Rechargez la bulle avant de réessayer." }, { status: 409 });
      if (body.enabled && (!eligibility.allowed || !profileReady)) return NextResponse.json({ ok: false, error: !eligibility.allowed
        ? "L’annuaire n’est pas disponible pour cet établissement. Vérifiez vos accès et votre abonnement."
        : "Complétez le nom de votre entreprise, votre ville et votre métier avant d’activer l’annuaire." }, { status: 400 });
      enabled = body.enabled;
      await saveDirectorySetting(supabase, activeUserId, enabled, config.data);
      revalidatePath("/annuaire");
      // Local development must never invalidate the production WordPress cache.
      if (process.env.NODE_ENV === "production") {
        try { await purgeInrSearchDirectoryCache({ reason: enabled ? "directory_enabled" : "directory_disabled" }); }
        catch { warning = "Le choix est enregistré. L’actualisation du site peut prendre un peu de temps."; }
      }
    }
    const badgeUrl = companyName ? createInrBadgePublicUrl({ userId: activeUserId, companyLegalName: companyName,
      firstName: String(profile.first_name || ""), lastName: String(profile.last_name || ""), logoUrl: "", phone: "", contactEmail: "" }) : "";
    return NextResponse.json({ ok: true, accountId: activeUserId, enabled, visible: enabled && profileReady && eligibility.allowed,
      allowed: eligibility.allowed, profileReady, companyName, city, profession: trade.profession, badgeUrl, warning }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: getSimpleFrenchErrorMessage(error, "L’annuaire est momentanément indisponible.") }, { status: 503 });
  }
}

export async function GET() { return handle(); }
export async function POST(request: Request) { return handle(request); }
