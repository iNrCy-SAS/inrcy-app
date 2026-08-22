import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminSecurity";
import { ADMIN_USER_IDS } from "@/lib/roles";
import { APP_BUBBLE_KEYS, APP_BUBBLE_DEFAULT_ACCESS } from "@/lib/bubbleAccess";
import { getTrialDays, TRIAL_REMINDER_OFFSETS } from "@/lib/trialSubscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function present(name: string, value: unknown) {
  return { name, ok: Boolean(value), value: Boolean(value) ? "Configuré" : "Manquant" };
}

async function getSubscriptionStatusCounts() {
  try {
    const { data, error } = await supabaseAdmin.from("subscriptions").select("status").limit(10000);
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const key = String((row as any).status || "sans_statut");
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  } catch {
    return null;
  }
}

export async function GET() {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  const subscriptionStatusCounts = await getSubscriptionStatusCounts();
  const defaultEnabledCount = APP_BUBBLE_KEYS.filter((key) => APP_BUBBLE_DEFAULT_ACCESS[key]).length;

  return NextResponse.json({
    mode: "read_only_v1",
    trial: {
      days: getTrialDays(),
      reminderOffsets: TRIAL_REMINDER_OFFSETS,
    },
    admin: {
      hardAdminCount: ADMIN_USER_IDS.length,
      adminOnly: true,
      staffAllowed: false,
    },
    bubbleAccess: {
      totalTools: APP_BUBBLE_KEYS.length,
      defaultEnabledCount,
      defaultDisabledCount: APP_BUBBLE_KEYS.length - defaultEnabledCount,
      defaultDisabledTools: APP_BUBBLE_KEYS.filter((key) => !APP_BUBBLE_DEFAULT_ACCESS[key]),
    },
    environment: [
      present("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL),
      present("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL),
      present("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
      present("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
      present("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY),
      present("STRIPE_PRICE_STARTER_ID", process.env.STRIPE_PRICE_STARTER_ID),
      present("STRIPE_PRICE_ACCEL_ID", process.env.STRIPE_PRICE_ACCEL_ID),
      present("AI_GATEWAY_API_KEY", process.env.AI_GATEWAY_API_KEY),
      present("VERCEL_OIDC_TOKEN", process.env.VERCEL_OIDC_TOKEN),
      present("AI_GATEWAY_MODEL", process.env.AI_GATEWAY_MODEL),
      present("AI_GATEWAY_VISION_MODEL", process.env.AI_GATEWAY_VISION_MODEL),
      present("AI_GATEWAY_FALLBACK_MODEL", process.env.AI_GATEWAY_FALLBACK_MODEL),
      present("AI_GATEWAY_OPENAI_PRIMARY_FALLBACK_MODEL", process.env.AI_GATEWAY_OPENAI_PRIMARY_FALLBACK_MODEL),
      present("OPENAI_API_KEY", process.env.OPENAI_API_KEY),
      present("OPENAI_DIRECT_FALLBACK_MODEL", process.env.OPENAI_DIRECT_FALLBACK_MODEL),
      present("AI_GATEWAY_MODEL_PRICING_JSON", process.env.AI_GATEWAY_MODEL_PRICING_JSON),
      present("AI_GATEWAY_FALLBACK_INPUT_USD_PER_MILLION", process.env.AI_GATEWAY_FALLBACK_INPUT_USD_PER_MILLION),
      present("AI_GATEWAY_FALLBACK_OUTPUT_USD_PER_MILLION", process.env.AI_GATEWAY_FALLBACK_OUTPUT_USD_PER_MILLION),
      present("AI_GATEWAY_TRANSCRIBE_MODEL", process.env.AI_GATEWAY_TRANSCRIBE_MODEL),
      present("AI_GATEWAY_TRANSCRIBE_FALLBACK_MODEL", process.env.AI_GATEWAY_TRANSCRIBE_FALLBACK_MODEL),
      present("TX_SMTP_HOST", process.env.TX_SMTP_HOST),
      present("TX_SMTP_USER", process.env.TX_SMTP_USER),
      present("MONITORING_SMTP_USER", process.env.MONITORING_SMTP_USER),
      present("MONITORING_MAIL_FROM", process.env.MONITORING_MAIL_FROM),
      present("CRON_SECRET", process.env.CRON_SECRET),
      present("ADMIN_SECRET", process.env.ADMIN_SECRET),
      present("SUPABASE_NEW_USER_WEBHOOK_SECRET", process.env.SUPABASE_NEW_USER_WEBHOOK_SECRET),
      present("INRCY_DIAGNOSTIC_REPORT_TO", process.env.INRCY_DIAGNOSTIC_REPORT_TO),
    ],
    subscriptionStatusCounts,
    warning: "V1 affiche les réglages sensibles en lecture seule. Les modifications de prod restent dans Vercel / Supabase / Stripe.",
  });
}
