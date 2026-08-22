import "server-only";

import { sendMonitoringMail } from "@/lib/txMailer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { optionalEnv } from "@/lib/env";

type AdminAlertType =
  | "trial_started"
  | "checkout_completed"
  | "subscription_activated"
  | "cancellation_requested"
  | "cancellation_reversed"
  | "subscription_deleted"
  | "trial_account_expired";

type AdminAlertInput = {
  type: AdminAlertType;
  userId: string;
  accountEmail?: string | null;
  profileContactEmail?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  plan?: string | null;
  scheduledPlan?: string | null;
  status?: string | null;
  trialStartAt?: string | null;
  trialEndAt?: string | null;
  cancelRequestedAt?: string | null;
  endDate?: string | null;
  nextRenewalDate?: string | null;
  source?: string | null;
  note?: string | null;
};

type SubscriptionContext = {
  accountEmail: string | null;
  profileContactEmail: string | null;
};

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function labelForType(type: AdminAlertType) {
  switch (type) {
    case "trial_started":
      return "Début de période d'essai";
    case "checkout_completed":
      return "Abonnement programmé via Stripe Checkout";
    case "subscription_activated":
      return "Abonnement activé";
    case "cancellation_requested":
      return "Résiliation demandée";
    case "cancellation_reversed":
      return "Résiliation annulée";
    case "subscription_deleted":
      return "Abonnement Stripe terminé";
    case "trial_account_expired":
      return "Compte bloqué après fin d'essai";
    default:
      return "Événement abonnement";
  }
}

export async function getSubscriptionContext(userId: string): Promise<SubscriptionContext> {
  const [{ data: subRow }, { data: profileRow }, authRes] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("contact_email")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("admin_email, contact_email")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(userId).catch(() => null),
  ]);

  const authEmail = authRes?.data?.user?.email?.trim() ?? null;
  const accountEmail =
    (profileRow as { admin_email?: string | null } | null)?.admin_email?.trim() ||
    (subRow as { contact_email?: string | null } | null)?.contact_email?.trim() ||
    authEmail ||
    null;

  const profileContactEmail =
    (profileRow as { contact_email?: string | null } | null)?.contact_email?.trim() || null;

  return { accountEmail, profileContactEmail };
}

export async function sendAdminSubscriptionAlert(input: AdminAlertInput) {
  const subject = `iNrCy — ${labelForType(input.type)} — ${input.userId}`;
  const destination = optionalEnv("INRCY_SUBSCRIPTION_ALERT_EMAIL", "abonnement@inrcy.com");

  const rawRows: Array<[string, string | null | undefined]> = [
    ["Événement", labelForType(input.type)],
    ["Source", input.source || "système"],
    ["User_id", input.userId],
    ["Email du compte", input.accountEmail || "Non renseigné"],
    ["Email de contact profil", input.profileContactEmail || "Non renseigné"],
    ["Boîte d'alerte", destination],
    ["Plan", input.plan || null],
    ["Plan programmé", input.scheduledPlan || null],
    ["Statut", input.status || null],
    ["Stripe customer_id", input.stripeCustomerId || null],
    ["Stripe subscription_id", input.stripeSubscriptionId || null],
    ["Stripe price_id", input.stripePriceId || null],
    ["Début essai", input.trialStartAt || null],
    ["Fin essai", input.trialEndAt || null],
    ["Résiliation demandée le", input.cancelRequestedAt || null],
    ["Date de fin", input.endDate || null],
    ["Prochain renouvellement", input.nextRenewalDate || null],
    ["Note", input.note || null],
  ];

  const rows: Array<[string, string]> = rawRows.flatMap(([label, value]) => {
    if (value == null) return [];
    const normalized = String(value).trim();
    return normalized ? [[label, normalized]] : [];
  });

  const text = [
    `Événement : ${labelForType(input.type)}`,
    ...rows.slice(1).map(([label, value]) => `${label} : ${value}`),
  ].join("\n");

  const htmlRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;font-weight:700;vertical-align:top">${esc(label)}</td>
          <td style="padding:6px 0;vertical-align:top">${esc(value)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 16px">${esc(labelForType(input.type))}</h2>
      <table style="border-collapse:collapse">${htmlRows}</table>
    </div>
  `;

  await sendMonitoringMail({
    to: destination,
    subject,
    text,
    html,
  });
}

export async function sendAdminSubscriptionAlertForUser(
  input: Omit<AdminAlertInput, "accountEmail" | "profileContactEmail"> & {
    accountEmail?: string | null;
    profileContactEmail?: string | null;
  }
) {
  const context =
    input.accountEmail !== undefined || input.profileContactEmail !== undefined
      ? {
          accountEmail: input.accountEmail ?? null,
          profileContactEmail: input.profileContactEmail ?? null,
        }
      : await getSubscriptionContext(input.userId);

  return sendAdminSubscriptionAlert({
    ...input,
    accountEmail: context.accountEmail,
    profileContactEmail: context.profileContactEmail,
  });
}
