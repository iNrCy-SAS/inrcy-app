import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tryDecryptToken, encryptToken } from "@/lib/oauthCrypto";

export type StatsSourceKey = "site_inrcy" | "site_web" | "gmb" | "facebook";
export type StatsProductKey = "ga4" | "gsc" | "gmb" | "facebook";

export type GoogleTokenRow = {
  id: number;
  user_id: string;
  source: StatsSourceKey;
  product: StatsProductKey;
  provider: "google";
  email_address: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  scopes: string | null;
  resource_id: string | null;
  resource_label: string | null;
  status: string;
  meta: any;
};

export async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || "Connexion Google expirée. Merci de reconnecter le compte.");
  }

  const accessToken = data.access_token as string;
  const expiresIn = Number(data.expires_in || 3600);
  const expiresAtIso = new Date(Date.now() + expiresIn * 1000).toISOString();

  return { accessToken, expiresAtIso };
}

function isGoogleRefreshAuthenticationError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  return /invalid_grant|invalid_client|unauthorized_client|invalid refresh token|token has been expired|token has been revoked|refresh token.*(expired|revoked)|revoked.*refresh token/.test(
    message,
  );
}

async function markGoogleIntegrationDisconnected(row: GoogleTokenRow, userId: string) {
  const { error } = await supabaseAdmin
    .from("integrations")
    .update({
      status: "disconnected",
      access_token_enc: null,
      expires_at: null,
      meta: {
        ...(row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {}),
        needs_reconnect: true,
        needs_reconnect_at: new Date().toISOString(),
        needs_reconnect_channel: row.source,
        needs_reconnect_reason: "google_refresh_token_invalid",
      },
    })
    .eq("id", row.id)
    .eq("user_id", userId);

  if (error) {
    console.error("[googleStats] Unable to mark revoked Google integration disconnected", {
      integrationId: row.id,
      userId,
      error: error.message,
    });
  }
}

export function isExpired(expiresAtIso: string | null) {
  if (!expiresAtIso) return true;
  const t = new Date(expiresAtIso).getTime();
  // refresh 2 minutes early
  return Date.now() > t - 2 * 60 * 1000;
}

async function getAdminRefreshToken(): Promise<string | null> {
  const adminEmail = (process.env.INRCY_ADMIN_GOOGLE_EMAIL || "contact@admin-inrcy.com").trim().toLowerCase();
  const adminUserId = (process.env.INRCY_ADMIN_USER_ID || "").trim();

  const base = supabaseAdmin
    .from("integrations")
    .select("refresh_token_enc, updated_at")
    .eq("provider", "google")
    .eq("status", "connected")
    .not("refresh_token_enc", "is", null);

  const q = adminUserId ? base.eq("user_id", adminUserId) : base.ilike("email_address", adminEmail);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(1);
  if (error) return null;
  const token = String((data as any[])?.[0]?.refresh_token_enc || "").trim();
  return token ? tryDecryptToken(token) : null;
}

function normStatus(s: any) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

async function legacyOverrideDisconnected(
  _supabase: any,
  _userId: string,
  _provider: string,
  _source: string,
  _product: string
) {
  // The legacy integrations_statistiques table is no longer part of the current schema.
  // Current connection state is sourced exclusively from public.integrations.
  return false;
}

async function selectLatestGoogleIntegration(
  supabase: any,
  userId: string,
  source: StatsSourceKey,
  product: StatsProductKey
): Promise<GoogleTokenRow | null> {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", source)
    .eq("product", product)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw new Error("Lecture des données impossible pour le moment.");
  const rows = Array.isArray(data) ? (data as GoogleTokenRow[]) : [];
  return rows[0] ?? null;
}

export async function getGoogleTokenFor(
  source: StatsSourceKey,
  product: "ga4" | "gsc",
  ctx?: { supabase?: any; userId?: string }
) {
  const supabase = ctx?.supabase ?? (await createSupabaseServer());
  let effectiveUserId = ctx?.userId || "";
  if (!effectiveUserId) {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) throw new Error("Non authentifié.");
    effectiveUserId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
  }

  // Legacy override: si une ligne existe dans integrations_statistiques en "déconnecté",
  // on force OFF même si integrations contient encore un vieux token.
  if (await legacyOverrideDisconnected(supabase, effectiveUserId, "google", source, product)) {
    return null;
  }

  const row = await selectLatestGoogleIntegration(supabase, effectiveUserId, source, product);
  if (!row) return null;
  const usesAdmin = Boolean((row as any)?.meta?.uses_admin);

  let refreshToken = tryDecryptToken(row.refresh_token_enc);

  // Mode RENTED: pas de refresh_token sur la ligne client -> on utilise le refresh_token du compte admin iNrCy
  if (!refreshToken) {
    if (!usesAdmin) return null;
    refreshToken = await getAdminRefreshToken();
    if (!refreshToken) return null;
  }

  let accessToken = tryDecryptToken(row.access_token_enc);
  let expiresAt = row.expires_at;

  if (!accessToken || isExpired(expiresAt)) {
    let refreshed: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
    try {
      refreshed = await refreshGoogleAccessToken(refreshToken);
    } catch (error) {
      // A revoked/expired refresh token is a reconnect condition, not an
      // anonymous-session error. Persist that state so publication can return
      // a clear reconnect action instead of retrying a dead token forever.
      if (isGoogleRefreshAuthenticationError(error)) {
        await markGoogleIntegrationDisconnected(row, effectiveUserId);
        return null;
      }
      throw error;
    }
    accessToken = refreshed.accessToken;
    expiresAt = refreshed.expiresAtIso;

    // Refresh silently without disconnecting the integration.
    // A token expiry is a technical refresh event, not a business disconnection.
    const { error: tokenUpdateError } = await supabaseAdmin
      .from("integrations")
      .update({
        access_token_enc: accessToken ? encryptToken(accessToken) : null,
        expires_at: expiresAt,
        status: "connected",
      })
      .eq("id", row.id)
      .eq("user_id", effectiveUserId);

    if (tokenUpdateError) {
      console.error("[googleStats] Unable to persist refreshed Google token", {
        integrationId: row.id,
        userId: effectiveUserId,
        error: tokenUpdateError.message,
      });
    }
  }

  return { accessToken: accessToken!, row };
}

type StatsDateWindow = {
  start?: Date;
  end?: Date;
  startDateYmd?: string;
  endDateYmd?: string;
};

function resolveStatsDateWindow(days: number, window?: StatsDateWindow) {
  const end = window?.end instanceof Date ? window.end : new Date();
  const start = window?.start instanceof Date ? window.start : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return {
    start,
    end,
    startDateYmd: window?.startDateYmd || start.toISOString().slice(0, 10),
    endDateYmd: window?.endDateYmd || end.toISOString().slice(0, 10),
  };
}

export async function runGa4Report(accessToken: string, propertyId: string, days: number, window?: StatsDateWindow) {
  const resolvedWindow = resolveStatsDateWindow(days, window);


  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: resolvedWindow.startDateYmd, endDate: resolvedWindow.endDateYmd }],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
        ],
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Impossible de récupérer les statistiques Google Analytics pour le moment.");

  const row = data?.rows?.[0];
  const values = row?.metricValues?.map((v: any) => v?.value) || [];
  const [activeUsers, sessions, pageviews, engagementRate, avgSessionDuration] = values;

  return {
    users: Number(activeUsers || 0),
    sessions: Number(sessions || 0),
    pageviews: Number(pageviews || 0),
    engagementRate: Number(engagementRate || 0),
    avgSessionDuration: Number(avgSessionDuration || 0),
  };
}

// "Demandes captées" (leads) on GA4.
// 1) Prefer the native "conversions" metric (requires GA4 conversion configuration).
// 2) Fallback: sum common lead intent events.
export async function runGa4Leads(accessToken: string, propertyId: string, days: number, window?: StatsDateWindow) {
  const resolvedWindow = resolveStatsDateWindow(days, window);

  // Prefer conversions
  try {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: resolvedWindow.startDateYmd, endDate: resolvedWindow.endDateYmd }],
          metrics: [{ name: "conversions" }],
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const row = (data as any)?.rows?.[0];
      const v = row?.metricValues?.[0]?.value;
      const n = Number(v || 0);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
  } catch {
    // ignore
  }

  // Fallback lead events
  const leadEvents = [
    "generate_lead",
    "form_submit",
    "contact",
    "contact_submit",
    "contact_form_submit",
    "request_quote",
    "phone_click",
    "click_to_call",
    "email_click",
  ];

  const res2 = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: resolvedWindow.startDateYmd, endDate: resolvedWindow.endDateYmd }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: { values: leadEvents },
          },
        },
        limit: 50,
      }),
    }
  );

  const data2 = await res2.json().catch(() => ({}));
  if (!res2.ok) throw new Error((data2 as any)?.error?.message || "Impossible de récupérer les conversions Google Analytics pour le moment.");

  const rows = Array.isArray((data2 as any)?.rows) ? (data2 as any).rows : [];
  let sum = 0;
  for (const r of rows) {
    const v = Number(r?.metricValues?.[0]?.value || 0);
    if (Number.isFinite(v)) sum += v;
  }
  return Math.max(0, sum);
}

export async function runGa4TopPages(accessToken: string, propertyId: string, days: number, window?: StatsDateWindow) {
  const resolvedWindow = resolveStatsDateWindow(days, window);

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: resolvedWindow.startDateYmd, endDate: resolvedWindow.endDateYmd }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 50,
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Impossible de récupérer les pages les plus vues pour le moment.");

  const rows = (data?.rows || []).map((r: any) => ({
    path: r?.dimensionValues?.[0]?.value || "/",
    views: Number(r?.metricValues?.[0]?.value || 0),
  }));

  return rows;
}

export async function runGa4Channels(accessToken: string, propertyId: string, days: number, window?: StatsDateWindow) {
  const resolvedWindow = resolveStatsDateWindow(days, window);

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: resolvedWindow.startDateYmd, endDate: resolvedWindow.endDateYmd }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 6,
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Impossible de récupérer les canaux d'acquisition pour le moment.");

  const rows = (data?.rows || []).map((r: any) => ({
    channel: r?.dimensionValues?.[0]?.value || "Other",
    sessions: Number(r?.metricValues?.[0]?.value || 0),
  }));

  return rows;
}

export async function runGscQuery(accessToken: string, property: string, days: number, window?: StatsDateWindow) {
  const resolvedWindow = resolveStatsDateWindow(days, window);

  const siteUrlEnc = encodeURIComponent(property);

  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrlEnc}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: resolvedWindow.startDateYmd,
        endDate: resolvedWindow.endDateYmd,
        dimensions: ["query"],
        rowLimit: 100,
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Impossible de récupérer les données Search Console pour le moment.");

  const rows = (data?.rows || []).map((r: any) => ({
    query: r?.keys?.[0] || "",
    clicks: Number(r?.clicks || 0),
    impressions: Number(r?.impressions || 0),
    ctr: Number(r?.ctr || 0),
    position: Number(r?.position || 0),
  }));

  return { rows };
}


// Generic helper for any Google-backed integration stored in integrations (GA4, GSC, GMB, ...).
export async function getGoogleTokenForAnyGoogle(
  source: StatsSourceKey,
  product: StatsProductKey,
  ctx?: { supabase?: any; userId?: string }
) {
  const supabase = ctx?.supabase ?? (await createSupabaseServer());
  let userId = ctx?.userId || "";
  if (!userId) {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) throw new Error("Non authentifié.");
    userId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
  }

  if (await legacyOverrideDisconnected(supabase, userId, "google", source, product)) {
    return null;
  }

  const row = await selectLatestGoogleIntegration(supabase, userId, source, product);
  if (!row) return null;

  let accessToken = tryDecryptToken(row.access_token_enc);
  let expiresAt = row.expires_at;
  if (accessToken && !isExpired(expiresAt)) {
    return { accessToken, row };
  }

  const refreshToken = tryDecryptToken(row.refresh_token_enc);
  if (!refreshToken) return null;

  if (!accessToken || isExpired(expiresAt)) {
    let refreshed: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
    try {
      refreshed = await refreshGoogleAccessToken(refreshToken);
    } catch (error) {
      // A revoked/expired refresh token is a reconnect condition. Persist it
      // as disconnected so the caller can ask the user to reconnect once,
      // instead of returning the same failure on every publication retry.
      if (isGoogleRefreshAuthenticationError(error)) {
        await markGoogleIntegrationDisconnected(row, userId);
        return null;
      }
      throw error;
    }
    accessToken = refreshed.accessToken;
    expiresAt = refreshed.expiresAtIso;

    const { error: tokenUpdateError } = await supabaseAdmin
      .from("integrations")
      .update({
        access_token_enc: accessToken ? encryptToken(accessToken) : null,
        expires_at: expiresAt,
        status: "connected",
      })
      .eq("id", row.id)
      .eq("user_id", userId);

    if (tokenUpdateError) {
      console.error("[googleStats] Unable to persist refreshed Google token", {
        integrationId: row.id,
        userId,
        error: tokenUpdateError.message,
      });
    }
  }

  return { accessToken, row };
}
