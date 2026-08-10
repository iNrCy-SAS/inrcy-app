import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminSecurity";
import { ADMIN_USER_IDS } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type UserStatusFilter = "all" | "none" | string;
type RoleFilter = "all" | "user" | "admin" | "staff" | "none";

const SUB_SELECT =
  "user_id,contact_email,app_edition,plan,scheduled_plan,status,monthly_price_eur,start_date,trial_start_at,trial_end_at,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,founder_offer_enabled,updated_at";

const PROFILE_SELECT_WITH_ROLE =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone,role,last_active_at,updated_at";

const PROFILE_SELECT_FALLBACK =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone,last_active_at,updated_at";

const ALLOWED_ROLES = new Set(["user", "admin"]);
const ALLOWED_APP_EDITIONS = new Set(["standard", "premium"]);
const ALLOWED_SUBSCRIPTION_STATUSES = new Set([
  "trialing",
  "active",
  "trial_expired",
  "paused",
  "past_due",
  "unpaid",
  "canceled",
  "cancelled",
  "incomplete",
  "incomplete_expired",
]);

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize(value: unknown) {
  return cleanText(value).toLowerCase();
}

function includesSearch(row: any, q: string) {
  if (!q) return true;
  const haystack = [
    row.user_id,
    row.email,
    row.profile?.admin_email,
    row.profile?.contact_email,
    row.profile?.first_name,
    row.profile?.last_name,
    row.profile?.company_legal_name,
    row.profile?.phone,
    row.subscription?.contact_email,
    row.subscription?.app_edition,
    row.subscription?.plan,
    row.subscription?.status,
    row.subscription?.stripe_customer_id,
    row.subscription?.stripe_subscription_id,
  ]
    .map((value) => normalize(value))
    .join(" ");

  return haystack.includes(q);
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

async function fetchMultiAccountConfigs(userIds: string[]) {
  if (!userIds.length) return new Map<string, any>();

  const { data, error } = await supabaseAdmin
    .from("inrcy_multi_account_config")
    .select("auth_user_id,multi_account_enabled,max_establishments,updated_at")
    .in("auth_user_id", userIds);

  if (error) throw error;

  const map = new Map<string, any>();
  for (const row of data ?? []) map.set(row.auth_user_id, row);
  return map;
}

async function fetchAccountCounts(userIds: string[]) {
  if (!userIds.length) return new Map<string, number>();

  const { data, error } = await supabaseAdmin
    .from("inrcy_account_members")
    .select("auth_user_id,account_id")
    .in("auth_user_id", userIds);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const authUserId = String(row.auth_user_id || "");
    if (!authUserId) continue;
    counts.set(authUserId, (counts.get(authUserId) || 0) + 1);
  }
  return counts;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  try {
    const url = new URL(request.url);
    const q = normalize(url.searchParams.get("q"));
    const roleFilter = (url.searchParams.get("role") || "all") as RoleFilter;
    const statusFilter = (url.searchParams.get("status") || "all") as UserStatusFilter;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 200);

    const users = await listAuthUsers(limit);
    const userIds = users.map((user: any) => user.id).filter(Boolean);

    const [profiles, subscriptions, multiAccountConfigs, accountCounts] = await Promise.all([
      fetchProfiles(userIds),
      fetchSubscriptions(userIds),
      fetchMultiAccountConfigs(userIds),
      fetchAccountCounts(userIds),
    ]);

    let rows = users.map((user: any) => {
      const profile = profiles.get(user.id) ?? null;
      const subscription = subscriptions.get(user.id) ?? null;
      const role = profile?.role || (ADMIN_USER_IDS.includes(user.id as any) ? "admin" : "user");
      const email = user.email || profile?.admin_email || subscription?.contact_email || null;
      const multiConfig = multiAccountConfigs.get(user.id) ?? null;
      const accountCount = Math.max(1, accountCounts.get(user.id) || 0);

      return {
        user_id: user.id,
        email,
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
        last_active_at: profile?.last_active_at ?? null,
        email_confirmed_at: user.email_confirmed_at ?? null,
        role,
        is_hard_admin: ADMIN_USER_IDS.includes(user.id as any),
        profile,
        subscription,
        multi_account: {
          multi_account_enabled: multiConfig?.multi_account_enabled === true,
          max_establishments: Math.max(1, Number(multiConfig?.max_establishments || 1)),
          account_count: accountCount,
          updated_at: multiConfig?.updated_at ?? null,
        },
      };
    });

    rows = rows.filter((row: any) => includesSearch(row, q));

    if (roleFilter !== "all") {
      if (roleFilter === "none") rows = rows.filter((row: any) => !row.role);
      else rows = rows.filter((row: any) => String(row.role || "").toLowerCase() === roleFilter);
    }

    if (statusFilter !== "all") {
      if (statusFilter === "none") rows = rows.filter((row: any) => !row.subscription?.status);
      else rows = rows.filter((row: any) => String(row.subscription?.status || "").toLowerCase() === statusFilter);
    }

    rows.sort((a: any, b: any) => {
      const ad = new Date(a.created_at || 0).getTime();
      const bd = new Date(b.created_at || 0).getTime();
      return bd - ad;
    });

    return NextResponse.json({
      users: rows,
      total: rows.length,
      limit,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Impossible de charger les comptes utilisateurs.", detail: error?.message || String(error) },
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

    const updates: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, "role")) {
      const role = cleanText(body.role, 20);
      if (!ALLOWED_ROLES.has(role)) {
        return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
      }

      if (ADMIN_USER_IDS.includes(userId as any) && role !== "admin") {
        return NextResponse.json({ error: "Impossible de retirer le rôle admin du compte principal." }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            user_id: userId,
            role,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) throw error;
      updates.role = role;
    }

    if (Object.prototype.hasOwnProperty.call(body, "subscription_status")) {
      const subscriptionStatus = cleanText(body.subscription_status, 40);
      if (!ALLOWED_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
        return NextResponse.json({ error: "Statut abonnement invalide." }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: subscriptionStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      updates.subscription_status = subscriptionStatus;
    }

    if (Object.prototype.hasOwnProperty.call(body, "app_edition")) {
      const appEdition = normalize(body.app_edition);
      if (!ALLOWED_APP_EDITIONS.has(appEdition)) {
        return NextResponse.json({ error: "Édition iNrCy invalide." }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          app_edition: appEdition,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      updates.app_edition = appEdition;
    }

    if (Object.prototype.hasOwnProperty.call(body, "founder_offer_enabled")) {
      const enabled = Boolean(body.founder_offer_enabled);

      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          founder_offer_enabled: enabled,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      updates.founder_offer_enabled = enabled;
    }

    const hasMultiEnabled = Object.prototype.hasOwnProperty.call(body, "multi_account_enabled");
    const hasMaxEstablishments = Object.prototype.hasOwnProperty.call(body, "max_establishments");

    if (hasMultiEnabled || hasMaxEstablishments) {
      const { data: existingConfig, error: existingConfigError } = await supabaseAdmin
        .from("inrcy_multi_account_config")
        .select("multi_account_enabled,max_establishments")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (existingConfigError) throw existingConfigError;

      const nextEnabled = hasMultiEnabled
        ? body.multi_account_enabled === true
        : existingConfig?.multi_account_enabled === true;
      const requestedMax = hasMaxEstablishments
        ? Number(body.max_establishments)
        : Number(existingConfig?.max_establishments || 1);

      if (!Number.isInteger(requestedMax) || requestedMax < 1 || requestedMax > 100) {
        return NextResponse.json({ error: "Nombre maximum d’établissements invalide (1 à 100)." }, { status: 400 });
      }

      const { data: configResult, error: configError } = await supabaseAdmin.rpc(
        "inrcy_set_multi_account_config",
        {
          p_auth_user_id: userId,
          p_enabled: nextEnabled,
          p_max_establishments: requestedMax,
        },
      );

      if (configError) {
        const message = configError.message || "";
        const match = message.match(/INRCY_MAX_BELOW_ACCOUNT_COUNT:(\d+)/);
        if (match) {
          return NextResponse.json(
            { error: `Impossible de descendre sous ${match[1]} établissement(s) déjà existant(s).` },
            { status: 409 },
          );
        }
        if (message.includes("INRCY_MAX_ESTABLISHMENTS_INVALID")) {
          return NextResponse.json({ error: "Nombre maximum d’établissements invalide (1 à 100)." }, { status: 400 });
        }
        throw configError;
      }

      const resultRow = Array.isArray(configResult) ? configResult[0] : configResult;
      updates.multi_account_enabled = resultRow?.multi_account_enabled ?? nextEnabled;
      updates.max_establishments = resultRow?.max_establishments ?? requestedMax;
      updates.account_count = resultRow?.account_count ?? null;
    }

    return NextResponse.json({ ok: true, updates });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Impossible de mettre à jour le compte.", detail: error?.message || String(error) },
      { status: 500 }
    );
  }
}
