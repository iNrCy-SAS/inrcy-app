import "server-only";

import { optionalEnv } from "@/lib/env";
import { insertNotificationOnce } from "@/lib/notificationWriter";
import { ADMIN_USER_IDS } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getInrcyLogoInlineAttachments } from "@/lib/txEmailAssets";
import { sendMonitoringMail } from "@/lib/txMailer";
import {
  adminTrialFollowupDedupeKey,
  type AdminTrialFollowupOffset,
} from "@/lib/trialFollowup";

type AdminTrialFollowupInput = {
  trialUserId: string;
  fullName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  trialStartAt: string | null;
  trialEndAt: string;
  daysBeforeEnd: AdminTrialFollowupOffset;
};

type NotificationMarker = {
  id: string;
  meta: Record<string, unknown> | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function displayName(input: AdminTrialFollowupInput) {
  return input.fullName || input.companyName || input.email || "Professionnel sans nom";
}

function formatFrenchDate(value: string | null) {
  if (!value) return "Non renseignée";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

async function loadNotificationMarker(adminUserId: string, dedupeKey: string) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id,meta")
    .eq("user_id", adminUserId)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as NotificationMarker | null;
}

export async function sendAdminTrialFollowupNotifications(input: AdminTrialFollowupInput) {
  const dedupeKey = adminTrialFollowupDedupeKey({
    trialUserId: input.trialUserId,
    trialEndAt: input.trialEndAt,
    daysBeforeEnd: input.daysBeforeEnd,
  });
  const name = displayName(input);
  const contactSummary = [input.phone, input.email].filter(Boolean).join(" · ") || "Coordonnées à compléter";
  let notificationsInserted = 0;

  for (const adminUserId of ADMIN_USER_IDS) {
    const result = await insertNotificationOnce({
      user_id: adminUserId,
      category: "action",
      kind: "admin_trial_followup_due",
      title: `Essai à relancer à J-${input.daysBeforeEnd} — ${name}`,
      body: `${contactSummary}. Fin d’essai le ${formatFrenchDate(input.trialEndAt)}.`,
      cta_label: "Ouvrir le suivi",
      cta_url: `/dashboard/admin/trials?focus=${encodeURIComponent(input.trialUserId)}`,
      dedupe_key: dedupeKey,
      meta: {
        source: "cron.billing.admin-trial-followup",
        trial_user_id: input.trialUserId,
        trial_start_at: input.trialStartAt,
        trial_end_at: input.trialEndAt,
        days_before_end: input.daysBeforeEnd,
        admin_email_sent_at: null,
      },
    });
    if (result.inserted) notificationsInserted += 1;
  }

  const primaryAdminId = ADMIN_USER_IDS[0];
  if (!primaryAdminId) return { notificationsInserted, emailSent: false };

  const marker = await loadNotificationMarker(primaryAdminId, dedupeKey);
  const markerMeta = marker?.meta && typeof marker.meta === "object" ? marker.meta : {};
  if (!marker || markerMeta.admin_email_sent_at) {
    return { notificationsInserted, emailSent: false };
  }

  const destination = optionalEnv("INRCY_SUBSCRIPTION_ALERT_EMAIL", "abonnement@inrcy.com");
  const subject = `iNrCy — Essai à relancer à J-${input.daysBeforeEnd} — ${name}`;
  const details: Array<[string, string]> = [
    ["Professionnel", name],
    ["Société", input.companyName || "Non renseignée"],
    ["Téléphone", input.phone || "Non renseigné"],
    ["E-mail", input.email || "Non renseigné"],
    ["Inscription", formatFrenchDate(input.trialStartAt)],
    ["Fin de période d’essai", formatFrenchDate(input.trialEndAt)],
    ["Priorité", `Rappel à J-${input.daysBeforeEnd}`],
  ];
  const text = details.map(([label, value]) => `${label} : ${value}`).join("\n");
  const htmlRows = details
    .map(([label, value]) => `<tr><td style="padding:6px 14px 6px 0;font-weight:700;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`)
    .join("");

  await sendMonitoringMail({
    to: destination,
    subject,
    text,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#111827"><h2 style="margin:0 0 12px">Période d’essai à suivre</h2><p>Une relance commerciale est à prévoir dans le cockpit Admin.</p><table style="border-collapse:collapse">${htmlRows}</table></div>`,
    attachments: await getInrcyLogoInlineAttachments(),
  });

  await supabaseAdmin
    .from("notifications")
    .update({
      meta: {
        ...markerMeta,
        admin_email_sent_at: new Date().toISOString(),
      },
    })
    .eq("id", marker.id);

  return { notificationsInserted, emailSent: true };
}
