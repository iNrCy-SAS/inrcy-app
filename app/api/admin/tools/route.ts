import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminSecurity";
import { purgeInrSearchDirectoryCache } from "@/lib/inrSearchDirectoryCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { revalidateInrSearchPublicRoutes } from "@/lib/inrSearchProvisioning";
import {
  APP_BUBBLE_ALWAYS_ENABLED_KEYS,
  APP_BUBBLE_DEFAULT_ACCESS,
  APP_BUBBLE_KEYS,
  buildBubbleAccessMap,
  createDefaultBubbleAccessRows,
  isAppBubbleAlwaysEnabled,
  normalizeAppBubbleKey,
  type AppBubbleAccessRow,
  type AppBubbleKey,
} from "@/lib/bubbleAccess";

export const runtime = "nodejs";

async function syncInrSearchDirectoryAfterAdminChange() {
  revalidateInrSearchPublicRoutes();
  try {
    await purgeInrSearchDirectoryCache({ reason: "admin_access_changed" });
  } catch (error) {
    console.error("[admin-tools] WordPress directory cache purge failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const PROFILE_SELECT_WITH_ROLE =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone,role,updated_at";

const PROFILE_SELECT_FALLBACK =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone,updated_at";

const SUB_SELECT =
  "user_id,contact_email,plan,status,trial_end_at,next_renewal_date,stripe_subscription_id,founder_offer_enabled";

const TOOL_LABELS: Record<AppBubbleKey, { label: string; group: string; description: string; default_enabled: boolean }> = {
  inrbadge: { label: "iNr’Badge", group: "Entrée", description: "QR code public et prise de contact.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.inrbadge },
  mails: { label: "Mails", group: "Diffusion", description: "Comptes mails et diffusion par email.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.mails },
  site_inrcy: { label: "Site iNrCy", group: "Diffusion", description: "Site généré par iNrCy.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.site_inrcy },
  site_web: { label: "Site Web", group: "Diffusion", description: "Site externe du professionnel.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.site_web },
  gmb: { label: "Google Business", group: "Réseaux", description: "Fiche Google Business Profile.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.gmb },
  inr_search: { label: "iNr'Search", group: "Visibilité", description: "Page publique créée par iNrCy et optimisée pour Google, Bing et les moteurs IA.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.inr_search },
  facebook: { label: "Facebook", group: "Réseaux", description: "Page Facebook.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.facebook },
  instagram: { label: "Instagram", group: "Réseaux", description: "Compte Instagram.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.instagram },
  linkedin: { label: "LinkedIn", group: "Réseaux", description: "Page ou profil LinkedIn.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.linkedin },
  x: { label: "X", group: "Réseaux", description: "Publications et statistiques du compte X.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.x },
  tiktok: { label: "TikTok", group: "Réseaux", description: "Publication TikTok.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.tiktok },
  youtube_shorts: { label: "YouTube", group: "Réseaux", description: "Publication YouTube.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.youtube_shorts },
  pinterest: { label: "Pinterest", group: "Réseaux", description: "Visibilité inspirationnelle, photos et vidéos.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.pinterest },
  inr_agent: { label: "iNr’Agent", group: "IA", description: "Copilote / agent iNrCy.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.inr_agent },
  inr_calendar: { label: "iNrCalendar", group: "Outils", description: "Agenda et rendez-vous.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.inr_calendar },
  inr_crm: { label: "iNrCRM", group: "Outils", description: "Contacts et CRM.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.inr_crm },
  inr_send: { label: "iNrSend", group: "Outils", description: "Historique des publications et envois.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.inr_send },
  inr_stats: { label: "iNrStats", group: "Outils", description: "Statistiques et bilan.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.inr_stats },
  documents: { label: "Documents", group: "Outils", description: "Documents, devis et factures.", default_enabled: APP_BUBBLE_DEFAULT_ACCESS.documents },
};

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize(value: unknown) {
  return cleanText(value).toLowerCase();
}

async function listAuthUsers(limit: number) {
  const perPage = Math.min(Math.max(limit, 1), 200);
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage,
  } as any);

  if (error) throw error;
  return data?.users ?? [];
}

async function fetchProfiles(userIds: string[]) {
  if (!userIds.length) return new Map<string, any>();

  const primary = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_SELECT_WITH_ROLE)
    .in("user_id", userIds);

  let rows: any[] | null = primary.data as any[] | null;
  let error = primary.error;

  if (error && /role/i.test(error.message || "")) {
    const fallback = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT_FALLBACK)
      .in("user_id", userIds);

    rows = fallback.data as any[] | null;
    error = fallback.error;
  }

  if (error) throw error;

  const map = new Map<string, any>();
  for (const row of rows ?? []) map.set(row.user_id, row);
  return map;
}

async function fetchSubscriptions(userIds: string[]) {
  if (!userIds.length) return new Map<string, any>();

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(SUB_SELECT)
    .in("user_id", userIds);

  if (error) throw error;

  const map = new Map<string, any>();
  for (const row of data ?? []) map.set(row.user_id, row);
  return map;
}

async function ensureAccessRows(userIds: string[]) {
  if (!userIds.length) return new Map<string, AppBubbleAccessRow[]>();

  const { data: existingRows, error: readError } = await supabaseAdmin
    .from("app_bubble_access")
    .select("user_id,bubble_key,enabled")
    .in("user_id", userIds);

  if (readError) throw readError;

  const existing = existingRows as Array<AppBubbleAccessRow & { user_id?: string | null }> | null;
  const byUser = new Map<string, AppBubbleAccessRow[]>();
  const existingKeysByUser = new Map<string, Set<string>>();

  for (const row of existing ?? []) {
    const userId = row.user_id;
    if (!userId) continue;
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId)!.push(row);
    if (!existingKeysByUser.has(userId)) existingKeysByUser.set(userId, new Set());
    if (row.bubble_key) existingKeysByUser.get(userId)!.add(row.bubble_key);
  }

  const forcedRows = userIds.flatMap((userId) => {
    const existingUserRows = byUser.get(userId) ?? [];
    return APP_BUBBLE_ALWAYS_ENABLED_KEYS
      .filter((bubbleKey) =>
        existingUserRows.some((row) => row.bubble_key === bubbleKey && row.enabled !== true),
      )
      .map((bubbleKey) => ({ user_id: userId, bubble_key: bubbleKey, enabled: true }));
  });
  const forcedKeyByUser = new Set(
    forcedRows.map((row) => `${row.user_id}:${row.bubble_key}`),
  );

  const missingRows = userIds.flatMap((userId) => {
    const existingKeys = existingKeysByUser.get(userId) ?? new Set<string>();
    return createDefaultBubbleAccessRows(userId).filter(
      (row) =>
        !existingKeys.has(row.bubble_key) &&
        !forcedKeyByUser.has(`${row.user_id}:${row.bubble_key}`),
    );
  });
  const rowsToUpsert = [...missingRows, ...forcedRows];

  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from("app_bubble_access")
      .upsert(rowsToUpsert, { onConflict: "user_id,bubble_key" });

    if (upsertError) throw upsertError;

    const { data: refreshedRows, error: refreshError } = await supabaseAdmin
      .from("app_bubble_access")
      .select("user_id,bubble_key,enabled")
      .in("user_id", userIds);

    if (refreshError) throw refreshError;

    byUser.clear();
    for (const row of (refreshedRows as Array<AppBubbleAccessRow & { user_id?: string | null }> | null) ?? []) {
      const userId = row.user_id;
      if (!userId) continue;
      if (!byUser.has(userId)) byUser.set(userId, []);
      byUser.get(userId)!.push(row);
    }
  }

  return byUser;
}

function matchesSearch(row: any, q: string) {
  if (!q) return true;
  const haystack = [
    row.user_id,
    row.email,
    row.company_name,
    row.full_name,
    row.profile?.phone,
    row.subscription?.plan,
    row.subscription?.status,
  ]
    .map((value) => normalize(value))
    .join(" ");

  return haystack.includes(q);
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  try {
    const url = new URL(request.url);
    const q = normalize(url.searchParams.get("q"));
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 200);

    const users = await listAuthUsers(limit);
    const userIds = users.map((user: any) => user.id).filter(Boolean);

    const [profiles, subscriptions, accessRowsByUser] = await Promise.all([
      fetchProfiles(userIds),
      fetchSubscriptions(userIds),
      ensureAccessRows(userIds),
    ]);

    const rows = users.map((user: any) => {
      const profile = profiles.get(user.id) ?? null;
      const subscription = subscriptions.get(user.id) ?? null;
      const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
      const companyName = profile?.company_legal_name || "Société non renseignée";
      const email = user.email || profile?.admin_email || subscription?.contact_email || null;
      const accessMap = buildBubbleAccessMap(accessRowsByUser.get(user.id));
      const enabledCount = Object.values(accessMap).filter(Boolean).length;

      return {
        user_id: user.id,
        email,
        created_at: user.created_at ?? null,
        role: profile?.role || "user",
        full_name: fullName || null,
        company_name: companyName,
        profile,
        subscription,
        access_map: accessMap,
        enabled_count: enabledCount,
        disabled_count: APP_BUBBLE_KEYS.length - enabledCount,
      };
    }).filter((row: any) => matchesSearch(row, q));

    rows.sort((a: any, b: any) => {
      const ac = String(a.company_name || a.email || "").toLowerCase();
      const bc = String(b.company_name || b.email || "").toLowerCase();
      return ac.localeCompare(bc, "fr");
    });

    return NextResponse.json({
      tools: APP_BUBBLE_KEYS.map((key) => ({ key, ...TOOL_LABELS[key] })),
      users: rows,
      total: rows.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Impossible de charger les accès outils.", detail: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json().catch(() => ({}));
    const userId = cleanText(body?.user_id, 80);
    if (!userId) {
      return NextResponse.json({ error: "Utilisateur obligatoire." }, { status: 400 });
    }

    if (body?.reset_defaults === true) {
      const rows = createDefaultBubbleAccessRows(userId);
      const { error } = await supabaseAdmin
        .from("app_bubble_access")
        .upsert(rows, { onConflict: "user_id,bubble_key" });

      if (error) throw error;
      await syncInrSearchDirectoryAfterAdminChange();
      return NextResponse.json({ ok: true, reset: true });
    }

    if (body?.access_map && typeof body.access_map === "object" && !Array.isArray(body.access_map)) {
      const accessMap = body.access_map as Record<string, unknown>;
      const rows = Object.entries(accessMap).flatMap(([rawKey, enabled]) => {
        const bubbleKey = normalizeAppBubbleKey(rawKey);
        if (!bubbleKey) return [];
        return [{
          user_id: userId,
          bubble_key: bubbleKey,
          enabled: isAppBubbleAlwaysEnabled(bubbleKey) ? true : Boolean(enabled),
        }];
      });

      if (!rows.length) {
        return NextResponse.json({ error: "Aucun outil valide." }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from("app_bubble_access")
        .upsert(rows, { onConflict: "user_id,bubble_key" });

      if (error) throw error;
      if (rows.some((row) => row.bubble_key === "inr_search")) {
        await syncInrSearchDirectoryAfterAdminChange();
      }
      return NextResponse.json({ ok: true, updated: rows.length });
    }

    const bubbleKey = normalizeAppBubbleKey(body?.bubble_key);
    if (!bubbleKey) {
      return NextResponse.json({ error: "Outil invalide." }, { status: 400 });
    }

    const enabled = isAppBubbleAlwaysEnabled(bubbleKey) ? true : Boolean(body?.enabled);

    const { error } = await supabaseAdmin
      .from("app_bubble_access")
      .upsert(
        {
          user_id: userId,
          bubble_key: bubbleKey,
          enabled,
        },
        { onConflict: "user_id,bubble_key" }
      );

    if (error) throw error;
    if (bubbleKey === "inr_search") await syncInrSearchDirectoryAfterAdminChange();

    return NextResponse.json({ ok: true, bubble_key: bubbleKey, enabled });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Impossible de mettre à jour l’accès outil.", detail: error?.message || String(error) },
      { status: 500 }
    );
  }
}
