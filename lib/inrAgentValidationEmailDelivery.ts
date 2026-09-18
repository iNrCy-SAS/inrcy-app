import "server-only";

import { optionalEnv } from "@/lib/env";
import {
  acquireExecutionIdempotencyLock,
  completeExecutionIdempotencyLockOrThrow,
  failExecutionIdempotencyLock,
} from "@/lib/executionIdempotency";
import {
  buildInrAgentValidationEmail,
  buildInrAgentValidationEmailDeliveryKey,
  buildInrAgentValidationEmailMessageId,
  INR_AGENT_VALIDATION_EMAIL_LOCK_TTL_MS,
  INR_AGENT_VALIDATION_EMAIL_SCOPE,
} from "@/lib/inrAgentValidationEmailPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getInrcyLogoInlineAttachments } from "@/lib/txEmailAssets";
import { sendTxMail } from "@/lib/txMailer";

type SupabaseLike = any;

type ValidationEmailRecipient = {
  email: string | null;
  firstName: string | null;
  companyName: string | null;
};

function clean(value: unknown, maxLength = 300) {
  return String(value || "").trim().slice(0, maxLength);
}

function errorMessage(value: unknown) {
  return value instanceof Error
    ? value.message
    : clean(value, 1_000) || "Envoi de l’e-mail iNrAgent impossible.";
}

function smtpConfigured() {
  return Boolean(
    optionalEnv("TX_SMTP_HOST") &&
      optionalEnv("TX_SMTP_PORT") &&
      optionalEnv("TX_SMTP_USER") &&
      optionalEnv("TX_SMTP_PASS"),
  );
}

async function resolveValidationEmailRecipient(
  supabase: SupabaseLike,
  accountId: string,
): Promise<ValidationEmailRecipient> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("contact_email,first_name,company_legal_name")
    .eq("user_id", accountId)
    .maybeSingle();
  if (profileError) throw profileError;

  const directEmail = clean(profile?.contact_email, 320);
  if (directEmail) {
    return {
      email: directEmail,
      firstName: clean(profile?.first_name, 100) || null,
      companyName: clean(profile?.company_legal_name, 180) || null,
    };
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("inrcy_account_members")
    .select("auth_user_id,role,is_default,created_at")
    .eq("account_id", accountId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(20);
  if (membershipError) throw membershipError;
  const rows = Array.isArray(memberships) ? memberships : [];
  const owner = rows.find(
    (row) => clean(row?.role, 40).toLowerCase() === "owner",
  );
  const authUserId = clean(
    owner?.auth_user_id || rows[0]?.auth_user_id || accountId,
    160,
  );
  const authUser = authUserId
    ? await supabaseAdmin.auth.admin.getUserById(authUserId).catch(() => null)
    : null;

  return {
    email: clean(authUser?.data?.user?.email, 320) || null,
    firstName: clean(profile?.first_name, 100) || null,
    companyName: clean(profile?.company_legal_name, 180) || null,
  };
}

export async function deliverInrAgentValidationReadyEmail(args: {
  supabase: SupabaseLike;
  userId: string;
  batchSignature: string;
  publicationCount: number;
  horizonDays: number;
  firstScheduledAt?: string | null;
  lastScheduledAt?: string | null;
}) {
  if (!smtpConfigured()) {
    return { status: "smtp_not_configured" as const };
  }

  const recipient = await resolveValidationEmailRecipient(
    args.supabase,
    args.userId,
  );
  if (!recipient.email) {
    return { status: "missing_recipient" as const };
  }

  const deliveryKey = buildInrAgentValidationEmailDeliveryKey({
    userId: args.userId,
    batchSignature: args.batchSignature,
  });
  const claim = await acquireExecutionIdempotencyLock({
    supabase: args.supabase,
    userId: args.userId,
    scope: INR_AGENT_VALIDATION_EMAIL_SCOPE,
    idempotencyKey: deliveryKey,
    ttlMs: INR_AGENT_VALIDATION_EMAIL_LOCK_TTL_MS,
    metadata: {
      batchSignature: args.batchSignature,
      publicationCount: args.publicationCount,
      firstScheduledAt: args.firstScheduledAt || null,
      lastScheduledAt: args.lastScheduledAt || null,
    },
  });

  if (claim.state === "completed") {
    return { status: "already_sent" as const };
  }
  if (claim.state === "running") {
    return { status: "already_sending" as const };
  }
  if (claim.state === "unavailable" || !claim.lock?.id) {
    console.error("[inr-agent] validation email blocked: idempotency unavailable", {
      userId: args.userId,
      batchSignature: args.batchSignature,
      error:
        claim.state === "unavailable" ? claim.error : "idempotency_lock_missing",
    });
    return { status: "idempotency_unavailable" as const };
  }

  const appUrl = optionalEnv(
    "NEXT_PUBLIC_APP_URL",
    optionalEnv("NEXT_PUBLIC_SITE_URL", "https://app.inrcy.com"),
  ).replace(/\/$/, "");
  const dashboardUrl = `${appUrl}/dashboard/agent`;
  const messageId = buildInrAgentValidationEmailMessageId(
    `${args.userId}:${args.batchSignature}`,
  );
  const mail = buildInrAgentValidationEmail({
    firstName: recipient.firstName,
    companyName: recipient.companyName,
    publicationCount: args.publicationCount,
    horizonDays: args.horizonDays,
    firstScheduledAt: args.firstScheduledAt,
    lastScheduledAt: args.lastScheduledAt,
    dashboardUrl,
  });

  try {
    await sendTxMail({
      to: recipient.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      messageId,
      attachments: await getInrcyLogoInlineAttachments(),
    });
    const sentAt = new Date().toISOString();
    await completeExecutionIdempotencyLockOrThrow({
      supabase: args.supabase,
      lockId: claim.lock.id,
      result: { ok: true, sentAt, messageId },
      metadata: {
        batchSignature: args.batchSignature,
        publicationCount: args.publicationCount,
        firstScheduledAt: args.firstScheduledAt || null,
        lastScheduledAt: args.lastScheduledAt || null,
      },
    });
    return { status: "sent" as const, sentAt };
  } catch (error) {
    await failExecutionIdempotencyLock({
      supabase: args.supabase,
      lockId: claim.lock.id,
      error: errorMessage(error),
      metadata: {
        batchSignature: args.batchSignature,
        publicationCount: args.publicationCount,
      },
    });
    console.error("[inr-agent] validation email delivery failed", {
      userId: args.userId,
      batchSignature: args.batchSignature,
      error,
    });
    return { status: "failed" as const, error: errorMessage(error) };
  }
}
