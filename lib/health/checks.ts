import "server-only";

import nodemailer from "nodemailer";
import { Redis } from "@upstash/redis";
import { requireEnv, optionalEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";
import { stripeGet } from "@/lib/stripeRest";
import { buildMediaPipelineCertificationSnapshot } from "@/lib/mediaPipelineCertification";
import {
  assertTxSmtpCircuitClosed,
  clearTxSmtpCircuit,
  openTxSmtpCircuit,
} from "@/lib/txSmtpCircuit";

export type HealthCheckName =
  | "supabase"
  | "kv"
  | "stripe"
  | "smtp"
  | "media_pipeline";

export type HealthCheckResult = {
  ok: boolean;
  ms: number | null;
  skipped?: boolean;
  error?: string | null;
  warning?: string | null;
  details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type DeepHealthReport = {
  ok: boolean;
  ts: string;
  version: string | null;
  total_ms: number;
  checks: Record<HealthCheckName, HealthCheckResult>;
};

type GlobalWithHealthRedis = typeof globalThis & {
  __inrcy_health_redis?: Redis;
};

function getVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    null
  );
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "unknown_error");
}

async function timeCheck(fn: () => Promise<void>): Promise<HealthCheckResult> {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t0, error: null };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: normalizeError(error),
    };
  }
}

function getRedis() {
  const url = requireEnv("KV_REST_API_URL");
  const token = requireEnv("KV_REST_API_TOKEN");
  const g = globalThis as GlobalWithHealthRedis;
  if (!g.__inrcy_health_redis) {
    g.__inrcy_health_redis = new Redis({ url, token });
  }
  return g.__inrcy_health_redis as Redis;
}

function canCheckSmtp() {
  return Boolean(
    process.env.TX_SMTP_HOST &&
      process.env.TX_SMTP_PORT &&
      process.env.TX_SMTP_USER &&
      process.env.TX_SMTP_PASS
  );
}

async function checkSupabase() {
  return timeCheck(async () => {
    const { error } = await supabaseAdmin.from("profiles").select("user_id").limit(1);
    if (error) throw new Error(error.message);
  });
}

async function checkKv(): Promise<HealthCheckResult> {
  if (shouldBypassUpstashInCurrentEnv()) {
    return {
      ok: true,
      ms: null,
      skipped: true,
      error: null,
    };
  }

  return timeCheck(async () => {
    const redis = getRedis();
    await redis.ping();
  });
}

async function checkStripe() {
  return timeCheck(async () => {
    await stripeGet("/balance");
  });
}

async function checkMediaPipeline(): Promise<HealthCheckResult> {
  const started = Date.now();
  const snapshot = buildMediaPipelineCertificationSnapshot();

  if (snapshot.stage === "disabled") {
    return {
      ok: true,
      ms: null,
      skipped: true,
      error: null,
      warning: null,
      details: {
        stage: snapshot.stage,
        full_cutover: false,
      },
    };
  }

  if (snapshot.errors.length > 0) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: `invalid_flags:${snapshot.errors.join(" | ")}`,
      warning: snapshot.warnings.join(" | ") || null,
      details: {
        stage: snapshot.stage,
        full_cutover: snapshot.fullCutoverEnabled,
      },
    };
  }

  try {
    const tableChecks = await Promise.all(
      [
        "pro_media_library",
        "publication_workspaces",
        "publication_workspace_media",
        "media_variants",
        "media_processing_jobs",
      ].map(async (table) => {
        const { error } = await supabaseAdmin.from(table).select("*").limit(1);
        if (error) throw new Error(`table_${table}:${error.message}`);
      }),
    );
    void tableChecks;

    const [boosterBucket, privateBucket] = await Promise.all([
      supabaseAdmin.storage.getBucket("booster"),
      supabaseAdmin.storage.getBucket("inrcy-pro-media"),
    ]);
    if (boosterBucket.error) {
      throw new Error(`bucket_booster:${boosterBucket.error.message}`);
    }
    if (privateBucket.error) {
      throw new Error(`bucket_inrcy_pro_media:${privateBucket.error.message}`);
    }
    if (privateBucket.data?.public) {
      throw new Error("bucket_inrcy_pro_media_must_be_private");
    }

    const nowIso = new Date().toISOString();
    const staleWorkspaceIso = new Date(Date.now() - 30 * 60_000).toISOString();
    const [expiredJobs, stalePublishing, failedJobs] = await Promise.all([
      supabaseAdmin
        .from("media_processing_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing")
        .lt("lock_expires_at", nowIso),
      supabaseAdmin
        .from("publication_workspaces")
        .select("id", { count: "exact", head: true })
        .eq("status", "publishing")
        .lt("updated_at", staleWorkspaceIso),
      supabaseAdmin
        .from("media_processing_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("updated_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString()),
    ]);

    for (const [label, result] of [
      ["expired_jobs", expiredJobs],
      ["stale_publishing", stalePublishing],
      ["failed_jobs_24h", failedJobs],
    ] as const) {
      if (result.error) throw new Error(`metric_${label}:${result.error.message}`);
    }

    const expiredJobCount = expiredJobs.count || 0;
    const stalePublishingCount = stalePublishing.count || 0;
    const warningParts = [...snapshot.warnings];
    if (expiredJobCount > 0) {
      warningParts.push(`${expiredJobCount} job(s) avec lease expirée`);
    }
    if (stalePublishingCount > 0) {
      warningParts.push(`${stalePublishingCount} workspace(s) publishing depuis plus de 30 min`);
    }

    return {
      ok: true,
      ms: Date.now() - started,
      error: null,
      warning: warningParts.join(" | ") || null,
      details: {
        stage: snapshot.stage,
        full_cutover: snapshot.fullCutoverEnabled,
        expired_processing_jobs: expiredJobCount,
        stale_publishing_workspaces: stalePublishingCount,
        failed_jobs_24h: failedJobs.count || 0,
      },
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: normalizeError(error),
      warning: snapshot.warnings.join(" | ") || null,
      details: {
        stage: snapshot.stage,
        full_cutover: snapshot.fullCutoverEnabled,
      },
    };
  }
}

async function checkSmtp(): Promise<HealthCheckResult> {
  if (!canCheckSmtp()) {
    return {
      ok: true,
      ms: null,
      skipped: true,
      error: null,
    };
  }

  return timeCheck(async () => {
    const host = requireEnv("TX_SMTP_HOST");
    const port = Number(requireEnv("TX_SMTP_PORT"));
    const user = requireEnv("TX_SMTP_USER");
    const pass = requireEnv("TX_SMTP_PASS");
    const secureEnv = optionalEnv("TX_SMTP_SECURE", "");
    const isProd = process.env.NODE_ENV === "production";
    const tlsRejectUnauthorized =
      optionalEnv("TX_SMTP_TLS_REJECT_UNAUTHORIZED", isProd ? "true" : "false") !== "false";
    const secure =
      secureEnv === "true" ? true : secureEnv === "false" ? false : port === 465;

    await assertTxSmtpCircuitClosed();

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
      tls: {
        rejectUnauthorized: tlsRejectUnauthorized,
      },
    });

    try {
      await transporter.verify();
      await clearTxSmtpCircuit();
    } catch (error) {
      await openTxSmtpCircuit(error);
      throw error;
    }
  });
}

export async function runPublicHealthCheck() {
  const started = Date.now();
  const supabase = await checkSupabase();

  return {
    ok: supabase.ok,
    ts: new Date().toISOString(),
    version: getVersion(),
    total_ms: Date.now() - started,
  };
}

export async function runDeepHealthChecks(): Promise<DeepHealthReport> {
  const started = Date.now();

  const [supabase, kv, stripe, smtp, mediaPipeline] = await Promise.all([
    checkSupabase(),
    checkKv(),
    checkStripe(),
    checkSmtp(),
    checkMediaPipeline(),
  ]);

  const checks: Record<HealthCheckName, HealthCheckResult> = {
    supabase,
    kv,
    stripe,
    smtp,
    media_pipeline: mediaPipeline,
  };

  const ok = Object.values(checks).every((check) => check.ok);

  return {
    ok,
    ts: new Date().toISOString(),
    version: getVersion(),
    total_ms: Date.now() - started,
    checks,
  };
}
