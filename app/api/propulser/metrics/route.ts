import { canonicalSiteWebChannel } from "@/lib/siteWebChannel";
import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { getIsoWeekStart, getIsoWeekId } from "@/lib/weeklyGoals";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";

type JsonRecord = Record<string, unknown>;
const asRecord = (v: unknown): JsonRecord =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : {};

type EventRow = {
  type: "valorize" | "review_mail" | "promo_mail";
  created_at: string;
  payload: unknown;
};

type CampaignRow = {
  track_kind: string | null;
  track_type: string | null;
  folder: string | null;
  created_at: string;
  sent_count: number | null;
  total_count: number | null;
};

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function positiveNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function eventRecipients(payload: JsonRecord) {
  return positiveNumber(payload["recipients"], 1);
}

function rememberLatest(target: { last_sent_at: string | null }, iso: string) {
  if (!target.last_sent_at || new Date(iso) > new Date(target.last_sent_at)) {
    target.last_sent_at = iso;
  }
}

function matchesCampaignType(row: CampaignRow, type: "valorize" | "review_mail" | "promo_mail") {
  const kind = String(row.track_kind || "").toLowerCase();
  const trackType = String(row.track_type || "").toLowerCase();
  const folder = String(row.folder || "").toLowerCase();
  const expectedLegacyFolder = type === "review_mail" ? "recoltes" : type === "promo_mail" ? "offres" : "";

  if (kind === "propulser" && trackType === type) return true;
  if (kind === "booster" && trackType === type) return true; // compat ancien historique
  if (!kind && trackType === type) return true;

  if (type !== "valorize") {
    if (kind === "propulser" && !trackType && folder === "propulsions") return true;
    if (kind === "booster" && !trackType && folder === expectedLegacyFolder) return true;
    if (!kind && !trackType && folder === expectedLegacyFolder) return true;
  }
  return false;
}

async function propulserMetricsHandler(req: Request) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") ?? 30)));

  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const userId = activeUserId;

  const sinceMonth = daysAgoISO(days);
  const sinceWeek = getIsoWeekStart();

  const eventsPromise = supabase
    .from("app_events")
    .select("type, created_at, payload")
    .eq("user_id", userId)
    .in("module", ["propulser", "booster"])
    // Sans ce filtre, la métrique téléchargeait aussi tous les événements de
    // publication asynchrone avec leur gros payload média puis les ignorait en
    // JavaScript. C'est la requête 57014 observée dans Sentry.
    .in("type", ["valorize", "review_mail", "promo_mail"])
    .gte("created_at", sinceMonth)
    .order("created_at", { ascending: false });

  const campaignsPromise = supabase
    .from("mail_campaigns")
    .select("track_kind, track_type, folder, created_at, sent_count, total_count")
    .eq("user_id", userId)
    .gte("created_at", sinceMonth)
    .gt("sent_count", 0)
    .order("created_at", { ascending: false });

  const [{ data: rows, error }, { data: campaignRows, error: campaignError }] = await Promise.all([
    eventsPromise,
    campaignsPromise,
  ]);

  if (error) {
    captureApiException(req, error, { area: "crm_campaigns", operation: "GET /api/propulser/metrics", statusCode: 500 });
    return jsonUserFacingError(error, { status: 500 });
  }
  if (campaignError) {
    captureApiException(req, campaignError, { area: "crm_campaigns", operation: "GET /api/propulser/metrics", statusCode: 500 });
    return jsonUserFacingError(campaignError, { status: 500 });
  }

  const events = (rows ?? []) as EventRow[];
  const campaigns = (campaignRows ?? []) as CampaignRow[];

  const init = () => ({
    month: 0,
    week: 0,
    channels: { site_web: 0, gmb: 0, facebook: 0, instagram: 0, linkedin: 0, tiktok: 0 } as Record<string, number>,
    sent: 0,
    last_sent_at: null as string | null,
  });

  const valorize = init();
  const review_mail = init();
  const promo_mail = init();
  const isWeek = (iso: string) => new Date(iso) >= sinceWeek;

  for (const e of events) {
    const payload = asRecord(e.payload);
    const inWeek = isWeek(e.created_at);

    if (e.type === "valorize") {
      valorize.month += 1;
      if (inWeek) valorize.week += 1;
      const ch = Array.isArray(payload["channels"])
        ? [...new Set((payload["channels"] as unknown[]).filter((channel) => typeof channel === "string").map(canonicalSiteWebChannel))]
        : [];
      const touched = ch.filter((c) => typeof c === "string").length || 1;
      valorize.sent += touched;
      for (const c of ch) {
        if (typeof c === "string") valorize.channels[c] = (valorize.channels[c] ?? 0) + 1;
      }
      rememberLatest(valorize, e.created_at);
    }

    // Compat : anciens événements Booster de récolte/offre peuvent encore exister.
    if (e.type === "review_mail") {
      review_mail.month += 1;
      if (inWeek) review_mail.week += 1;
      review_mail.sent += eventRecipients(payload);
      rememberLatest(review_mail, e.created_at);
    }
    if (e.type === "promo_mail") {
      promo_mail.month += 1;
      if (inWeek) promo_mail.week += 1;
      promo_mail.sent += eventRecipients(payload);
      rememberLatest(promo_mail, e.created_at);
    }
  }

  for (const campaign of campaigns) {
    const sent = positiveNumber(campaign.sent_count);
    if (sent <= 0) continue;
    const inWeek = isWeek(campaign.created_at);

    if (matchesCampaignType(campaign, "valorize")) {
      valorize.month += 1;
      if (inWeek) valorize.week += 1;
      valorize.sent += sent;
      rememberLatest(valorize, campaign.created_at);
    }

    if (matchesCampaignType(campaign, "review_mail")) {
      review_mail.month += 1;
      if (inWeek) review_mail.week += 1;
      review_mail.sent += sent;
      rememberLatest(review_mail, campaign.created_at);
    }

    if (matchesCampaignType(campaign, "promo_mail")) {
      promo_mail.month += 1;
      if (inWeek) promo_mail.week += 1;
      promo_mail.sent += sent;
      rememberLatest(promo_mail, campaign.created_at);
    }
  }

  return NextResponse.json({
    range_days: days,
    week_id: getIsoWeekId(),
    week_start: sinceWeek.toISOString(),
    valorize: {
      month: valorize.month,
      week: valorize.week,
      sent: valorize.sent,
      channels: valorize.channels,
      last_sent_at: valorize.last_sent_at,
    },
    review_mail: {
      month: review_mail.month,
      week: review_mail.week,
      sent: review_mail.sent,
      last_sent_at: review_mail.last_sent_at,
      opened: 0,
      clicked: 0,
      reviews: 0,
    },
    promo_mail: {
      month: promo_mail.month,
      week: promo_mail.week,
      sent: promo_mail.sent,
      last_sent_at: promo_mail.last_sent_at,
      opened: 0,
      clicked: 0,
      leads: 0,
    },
  });
}

export const GET = withApi(propulserMetricsHandler, { route: "/api/propulser/metrics" });
