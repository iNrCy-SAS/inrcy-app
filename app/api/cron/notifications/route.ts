import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";
import { buildNotificationDigestEmail, type NotificationDigestItem } from "@/lib/notificationDigestEmail";
import { optionalEnv } from "@/lib/env";
import { getInrcyLogoInlineAttachments } from "@/lib/txEmailAssets";
import { defaultNotificationPreferences } from "@/lib/notifications";
import {
  insertNotificationOnce,
  type NotificationInsertRow,
} from "@/lib/notificationWriter";

export const runtime = "nodejs";

type PrefRow = {
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  performance_enabled: boolean;
  action_enabled: boolean;
  information_enabled: boolean;
  digest_every_hours: number;
};

type UserIdRow = {
  user_id: string;
};

type SnapshotRow = {
  user_id: string;
  snapshot_date: string;
  connected_tools_count: number | null;
  demandes_captees_total: number | null;
  opportunites_activables_total: number | null;
  details: Record<string, unknown> | null;
};

type IntegrationRow = {
  provider: string | null;
  category: string | null;
  product: string | null;
  status: string | null;
};

type ProfileRow = {
  contact_email?: string | null;
  first_name?: string | null;
  company_legal_name?: string | null;
};

function isAuthorizedCron(req: Request) {
  const cronSecret = process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!cronSecret) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  const querySecret = new URL(req.url).searchParams.get("secret") || "";
  return bearer === cronSecret || headerSecret === cronSecret || querySecret === cronSecret;
}

function toInt(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function dedupeWindowKey(prefix: string) {
  const now = new Date();
  const yy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const bucket = Math.floor((now.getUTCDate() - 1) / 2) + 1;
  return `${prefix}:${yy}-${mm}-${dd}:b${bucket}`;
}

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function truthyDetailMetric(details: Record<string, unknown> | null | undefined, channel: string, metric: string) {
  const detail = safeObj(safeObj(details)[channel]);
  const metrics = safeObj(detail.metrics);
  const nestedMetrics = safeObj(metrics.metrics);
  const totals = safeObj(nestedMetrics.totals);
  return toInt(totals[metric] ?? nestedMetrics[metric] ?? metrics[metric] ?? detail[metric]);
}

function listMissingCoreChannels(integrations: IntegrationRow[]) {
  const connected = new Set(
    integrations
      .filter((row) => (row.status || "connected") === "connected")
      .map((row) => String(row.product || row.provider || "").toLowerCase())
      .filter(Boolean)
  );

  const core = [
    { key: "gmb", label: "Google Business" },
    { key: "facebook", label: "Facebook" },
    { key: "instagram", label: "Instagram" },
    { key: "gmail", label: "Gmail" },
    { key: "microsoft", label: "Microsoft" },
  ];

  return core.filter((item) => !connected.has(item.key)).map((item) => item.label);
}

async function hasRecentCategoryNotification(userId: string, category: string, hours: number) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("category", category)
    .gte("created_at", since)
    .limit(1);
  if (error) return false;
  return Boolean(data && data.length > 0);
}

async function insertNotification(row: NotificationInsertRow) {
  const result = await insertNotificationOnce(row);
  if (!result.inserted || !result.data) return null;
  return result.data as unknown as NotificationDigestItem;
}

async function buildPerformanceNotification(userId: string, digestHours: number) {
  if (await hasRecentCategoryNotification(userId, "performance", digestHours)) return null;
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("daily_metrics_summary")
    .select("user_id, snapshot_date, connected_tools_count, demandes_captees_total, opportunites_activables_total, details")
    .eq("user_id", userId)
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: false });
  if (error || !data || data.length === 0) return null;

  const snapshots = data as SnapshotRow[];
  const latest = snapshots[0];
  const previous = snapshots[1] ?? null;
  const demandes7d = snapshots.reduce((sum, row) => sum + toInt(row.demandes_captees_total), 0);
  const latestDemandes = toInt(latest.demandes_captees_total);
  const previousDemandes = toInt(previous?.demandes_captees_total);
  const opportunities = toInt(latest.opportunites_activables_total);
  const deltaDemandes = latestDemandes - previousDemandes;
  const topOpportunityChannel = ["gmb", "site_web", "site_inrcy", "facebook", "instagram", "linkedin"]
    .map((channel) => ({
      channel,
      value: toInt(safeObj(safeObj(latest.details)[channel]).opportunites_activables),
    }))
    .sort((a, b) => b.value - a.value)[0];

  if (demandes7d <= 0 && opportunities <= 0) return null;

  let title = `${demandes7d} demandes générées cette semaine sur vos canaux`;
  let body = `Votre machine a généré ${demandes7d} demandes sur les 7 derniers jours. C’est le bon moment pour amplifier ce qui fonctionne déjà.`;
  let ctaLabel = "Voir mes stats";
  let ctaUrl = "/dashboard/stats";
  let kind = "demandes_weekly";

  if (opportunities >= 8) {
    title = `+ ${opportunities} opportunités activables : on se lance ?`;
    body = topOpportunityChannel?.value
      ? `Le canal ${topOpportunityChannel.channel === 'gmb' ? 'Google Business' : topOpportunityChannel.channel.replace('_', ' ')} concentre à lui seul ${topOpportunityChannel.value} opportunités activables. Lancez une action simple cette semaine pour transformer ce potentiel en demandes.`
      : `Vos canaux ont encore du potentiel. Activez un mouvement simple cette semaine pour transformer ${opportunities} opportunités en demandes concrètes.`;
    ctaLabel = "Ouvrir Booster";
    ctaUrl = "/dashboard?action=publish";
    kind = "opportunities_weekly";
  } else if (deltaDemandes >= 3) {
    title = `Belle traction : +${deltaDemandes} demandes par rapport au dernier point`;
    body = `Votre rythme progresse. Vous avez capté ${latestDemandes} demandes sur le dernier snapshot, soit ${deltaDemandes} de plus qu’au point précédent.`;
    kind = "demandes_growth";
  } else if (latestDemandes === 0 && opportunities > 0) {
    title = `Vos canaux ont du potentiel, mais rien n’a encore été capté`;
    body = `Vous avez ${opportunities} opportunités activables sans demande récente détectée. C’est le bon moment pour lancer un booster ou reconnecter un canal chaud.`;
    ctaLabel = "Activer mes opportunités";
    ctaUrl = "/dashboard";
    kind = "opportunities_without_capture";
  }

  return insertNotification({
    user_id: userId,
    category: "performance",
    kind,
    title,
    body,
    cta_label: ctaLabel,
    cta_url: ctaUrl,
    meta: {
      demandes_7d: demandes7d,
      latest_demandes: latestDemandes,
      previous_demandes: previousDemandes,
      opportunities,
      connected_tools_count: latest.connected_tools_count ?? 0,
      top_opportunity_channel: topOpportunityChannel?.channel ?? null,
    },
    dedupe_key: dedupeWindowKey(`performance:${userId}`),
  });
}

async function buildActionNotification(userId: string, digestHours: number) {
  if (await hasRecentCategoryNotification(userId, "action", digestHours)) return null;
  const [{ data: integrations }, { data: latest }] = await Promise.all([
    supabaseAdmin
      .from("integrations")
      .select("provider, category, product, status")
      .eq("user_id", userId)
      .eq("status", "connected"),
    supabaseAdmin
      .from("daily_metrics_summary")
      .select("opportunites_activables_total, connected_tools_count, demandes_captees_total, details")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const connectedRows = (integrations ?? []) as IntegrationRow[];
  const opportunities = toInt(latest?.opportunites_activables_total);
  const connectedTools = toInt(latest?.connected_tools_count);
  const latestDemandes = toInt(latest?.demandes_captees_total);
  const missingChannels = listMissingCoreChannels(connectedRows);
  const facebookClicks = truthyDetailMetric(latest?.details as Record<string, unknown> | null, "facebook", "page_website_clicks")
    + truthyDetailMetric(latest?.details as Record<string, unknown> | null, "facebook", "phone_call_clicks");
  const instagramSignals = truthyDetailMetric(latest?.details as Record<string, unknown> | null, "instagram", "reach")
    + truthyDetailMetric(latest?.details as Record<string, unknown> | null, "instagram", "website_clicks");

  let title = "Il est temps de lancer une action booster";
  let body = "Un petit mouvement aujourd’hui peut relancer votre machine business sans vous submerger.";
  let ctaLabel = "Lancer Booster";
  let ctaUrl = "/dashboard?action=publish";
  let kind = "launch_booster";

  if (missingChannels.length > 0) {
    const topMissing = missingChannels.slice(0, 2).join(" + ");
    title = `${missingChannels.length} ${missingChannels.length > 1 ? "canaux" : "canal"} encore activable${missingChannels.length > 1 ? "s" : ""}`;
    body = `Votre générateur peut encore monter en puissance. Commencez par ${topMissing} pour capter plus d’opportunités dans les 48 prochaines heures.`;
    ctaLabel = "Configurer mes canaux";
    ctaUrl = "/dashboard";
    kind = "connect_channels";
  } else if (facebookClicks > 0 && !connectedRows.some((row) => (row.product || row.provider) === "facebook" && row.category === "social")) {
    title = "Votre compte Facebook est prêt, mais la page n’est pas encore reliée";
    body = `Le compte est connecté, mais la page Facebook doit encore être attachée pour publier et analyser. Veuillez effectuer cette dernière étape pour débloquer le canal.`;
    ctaLabel = "Relier ma page";
    ctaUrl = "/dashboard?panel=facebook";
    kind = "facebook_page_pending";
  } else if (instagramSignals > 0 && opportunities > 0 && latestDemandes === 0) {
    title = `Instagram chauffe : activez une action maintenant`;
    body = `Votre compte Instagram génère déjà des signaux de reach. Avec ${opportunities} opportunités activables et aucune demande captée récemment, le meilleur levier est une action booster.`;
    kind = "instagram_boost";
  } else if (opportunities > 0 || connectedTools >= 3) {
    title = `Votre machine est prête : passez à l’action`;
    body = `Vous avez ${opportunities} opportunités activables et ${connectedTools} canaux bien branchés. Le bon levier maintenant : lancer une action booster.`;
  }

  return insertNotification({
    user_id: userId,
    category: "action",
    kind,
    title,
    body,
    cta_label: ctaLabel,
    cta_url: ctaUrl,
    meta: { missing_channels: missingChannels, connected_tools: connectedTools, opportunities, latest_demandes: latestDemandes },
    dedupe_key: dedupeWindowKey(`action:${userId}`),
  });
}

async function buildInformationNotification(userId: string, digestHours: number) {
  if (await hasRecentCategoryNotification(userId, "information", digestHours)) return null;
  const [{ data: latest }, { data: integrations }, { data: crmContacts }] = await Promise.all([
    supabaseAdmin
      .from("daily_metrics_summary")
      .select("connected_tools_count, demandes_captees_total, opportunites_activables_total, details")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("integrations")
      .select("provider, category, product, status")
      .eq("user_id", userId)
      .eq("status", "connected"),
    supabaseAdmin
      .from("crm_contacts")
      .select("id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const connectedTools = toInt(latest?.connected_tools_count);
  const demandes = toInt(latest?.demandes_captees_total);
  const opportunities = toInt(latest?.opportunites_activables_total);
  const connectedRows = (integrations ?? []) as IntegrationRow[];
  const latestCrmContactAt = Array.isArray(crmContacts) && crmContacts[0]?.created_at ? new Date(String(crmContacts[0].created_at)) : null;
  const crmLooksEmptyOrStale = !latestCrmContactAt || (Date.now() - latestCrmContactAt.getTime()) > 30 * 24 * 3600 * 1000;

  const hasMail = connectedRows.some((row) => row.category === "mail");
  const hasSocial = connectedRows.some((row) => row.category === "social");
  const hasStats = connectedRows.some((row) => row.category === "stats");

  let title = connectedTools > 0
    ? `Votre cockpit iNrCy suit ${connectedTools} ${connectedTools > 1 ? "canaux" : "canal"}`
    : `Votre espace iNrCy est prêt à être animé`;
  let body = connectedTools > 0
    ? `Petit point de passage : ${demandes} demandes captées récemment, ${opportunities} opportunités activables, et un GPS d’utilisation à consulter pour garder le rythme.`
    : `Activez quelques canaux puis laissez iNrCy vous guider. Vos prochaines actions clés apparaîtront ensuite dans votre cloche.`;
  let ctaLabel = connectedTools > 0 ? "Ouvrir le GPS" : "Ouvrir le dashboard";
  let ctaUrl = connectedTools > 0 ? "/dashboard/gps" : "/dashboard";
  let kind = "cockpit_status";

  if (crmLooksEmptyOrStale) {
    title = latestCrmContactAt
      ? "Pensez à mettre votre CRM à jour"
      : "Votre CRM attend encore ses premiers contacts";
    body = latestCrmContactAt
      ? "Vos notifications tournent bien, mais votre CRM mérite un petit rafraîchissement. Ajoutez ou mettez à jour vos contacts chauds pour mieux suivre relances, rendez-vous et opportunités."
      : "Ajoutez quelques contacts dans iNrCRM pour relier vos rendez-vous, vos relances et vos opportunités au bon endroit.";
    ctaLabel = "Ouvrir le CRM";
    ctaUrl = "/dashboard/crm";
    kind = "crm_refresh";
  } else if (hasSocial && !hasMail) {
    title = "Votre visibilité tourne déjà, branchez maintenant la relance mail";
    body = `Vos canaux sociaux sont connectés. Ajouter une boîte mail dans iNr'Send vous permettra de relancer les opportunités entrantes sans quitter iNrCy.`;
    ctaLabel = "Ouvrir iNr'Send";
    ctaUrl = "/dashboard?panel=mails";
    kind = "cross_sell_mail";
  } else if (hasMail && !hasStats) {
    title = "Votre machine envoie, il lui manque encore ses capteurs";
    body = `Branchez Google Stats pour voir quelles actions produisent réellement des demandes et nourrir vos prochaines relances intelligentes.`;
    ctaLabel = "Connecter les stats";
    ctaUrl = "/dashboard?panel=google_stats";
    kind = "connect_stats";
  }

  return insertNotification({
    user_id: userId,
    category: "information",
    kind,
    title,
    body,
    cta_label: ctaLabel,
    cta_url: ctaUrl,
    meta: { connected_tools: connectedTools, demandes, opportunities, has_mail: hasMail, has_social: hasSocial, has_stats: hasStats },
    dedupe_key: dedupeWindowKey(`information:${userId}`),
  });
}

async function getProfileEmail(userId: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("contact_email, first_name, company_legal_name")
    .eq("user_id", userId)
    .maybeSingle();

  const row = (profile ?? null) as ProfileRow | null;
  const email = (row?.contact_email || "").trim();
  if (email) return { email, firstName: row?.first_name ?? null, companyName: row?.company_legal_name ?? null };

  const adminUser = await supabaseAdmin.auth.admin.getUserById(userId).catch(() => null);
  const fallbackEmail = adminUser?.data?.user?.email ?? null;
  return { email: fallbackEmail, firstName: row?.first_name ?? null, companyName: row?.company_legal_name ?? null };
}

async function maybeSendDigestEmail(userId: string, items: NotificationDigestItem[]) {
  if (items.length === 0) return { sent: false, reason: "no_items" as const };
  const smtpConfigured = Boolean(optionalEnv("TX_SMTP_HOST") && optionalEnv("TX_SMTP_PORT") && optionalEnv("TX_SMTP_USER") && optionalEnv("TX_SMTP_PASS"));
  if (!smtpConfigured) return { sent: false, reason: "smtp_not_configured" as const };

  const recipient = await getProfileEmail(userId);
  if (!recipient.email) return { sent: false, reason: "missing_email" as const };

  const appUrl = optionalEnv("NEXT_PUBLIC_SITE_URL", "https://app.inrcy.com").replace(/\/$/, "");
  const dashboardUrl = `${appUrl}/dashboard`;

  const { subject, html, text } = buildNotificationDigestEmail({
    firstName: recipient.firstName,
    companyName: recipient.companyName,
    items,
    dashboardUrl,
  });

  await sendTxMail({ to: recipient.email, subject, html, text, attachments: await getInrcyLogoInlineAttachments() });
  return { sent: true, reason: "sent" as const };
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const [{ data: prefRows, error: prefError }, { data: profileRows, error: profileError }] = await Promise.all([
    supabaseAdmin
      .from("notification_preferences")
      .select("user_id, in_app_enabled, email_enabled, performance_enabled, action_enabled, information_enabled, digest_every_hours"),
    supabaseAdmin
      .from("profiles")
      .select("user_id"),
  ]);

  if (prefError) return NextResponse.json({ error: prefError.message }, { status: 500 });
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  const prefMap = new Map<string, PrefRow>();
  for (const row of (prefRows ?? []) as PrefRow[]) {
    prefMap.set(row.user_id, row);
  }

  const userIds = new Set<string>();
  for (const row of (profileRows ?? []) as UserIdRow[]) {
    if (row.user_id) userIds.add(row.user_id);
  }
  for (const userId of prefMap.keys()) {
    userIds.add(userId);
  }

  const prefs = Array.from(userIds).map((userId) => {
    const existing = prefMap.get(userId);
    if (existing) {
      return {
        ...defaultNotificationPreferences(userId),
        ...existing,
        digest_every_hours: Math.max(24, Math.min(168, existing.digest_every_hours || 48)),
      } as PrefRow;
    }
    return defaultNotificationPreferences(userId);
  });

  let generated = 0;
  let emailed = 0;
  const errors: Array<{ user_id: string; message: string }> = [];

  for (const pref of prefs) {
    try {
      const hours = Math.max(24, Math.min(168, pref.digest_every_hours || 48));
      const createdItems: NotificationDigestItem[] = [];
      if (pref.performance_enabled) {
        const item = await buildPerformanceNotification(pref.user_id, hours);
        if (item) {
          generated += 1;
          createdItems.push(item);
        }
      }
      if (pref.action_enabled) {
        const item = await buildActionNotification(pref.user_id, hours);
        if (item) {
          generated += 1;
          createdItems.push(item);
        }
      }
      if (pref.information_enabled) {
        const item = await buildInformationNotification(pref.user_id, hours);
        if (item) {
          generated += 1;
          createdItems.push(item);
        }
      }
      const emailResult = pref.email_enabled !== false ? await maybeSendDigestEmail(pref.user_id, createdItems) : { sent: false, reason: "email_disabled" as const };
      if (emailResult.sent) emailed += 1;
    } catch (e: unknown) {
      errors.push({ user_id: pref.user_id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, users: prefs.length, generated, emailed, errors });
}
