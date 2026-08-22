import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { withApi } from "@/lib/observability/withApi";
import { optionalEnv, requireEnv } from "@/lib/env";
import { runDeepHealthChecks } from "@/lib/health/checks";
import { log } from "@/lib/observability/logger";
import { sendMonitoringMail } from "@/lib/txMailer";
import { isTxSmtpCircuitOpenError } from "@/lib/txSmtpCircuit";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";

export const runtime = "nodejs";

function isAuthorizedCron(req: Request) {
  const cronSecret = process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!cronSecret) return false;

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  const querySecret = new URL(req.url).searchParams.get("secret") || "";

  return bearer === cronSecret || headerSecret === cronSecret || querySecret === cronSecret;
}

function getRedis() {
  const url = requireEnv("KV_REST_API_URL");
  const token = requireEnv("KV_REST_API_TOKEN");
  return new Redis({ url, token });
}

function buildAlertBody(report: Awaited<ReturnType<typeof runDeepHealthChecks>>) {
  const lines = [
    `Santé infra iNrCy: ${report.ok ? "OK" : "KO"}`,
    `Date: ${report.ts}`,
    `Version: ${report.version || "n/a"}`,
    `Durée totale: ${report.total_ms} ms`,
    "",
    ...Object.entries(report.checks).map(([name, check]) => {
      const parts = [name, check.ok ? "OK" : "KO"];
      if (check.skipped) parts.push("skipped");
      if (typeof check.ms === "number") parts.push(`${check.ms} ms`);
      if (check.error) parts.push(`error=${check.error}`);
      if (check.warning) parts.push(`warning=${check.warning}`);
      if (check.details) parts.push(`details=${JSON.stringify(check.details)}`);
      return `- ${parts.join(" | ")}`;
    }),
  ];

  return lines.join("\n");
}

async function sendFailureAlert(report: Awaited<ReturnType<typeof runDeepHealthChecks>>) {
  const alertTo = optionalEnv("HEALTHCHECK_ALERT_TO", "").trim();
  if (!alertTo) return false;

  const dedupeSeconds = Number(optionalEnv("HEALTHCHECK_ALERT_DEDUPE_SECONDS", "21600"));
  let shouldSend = true;

  if (!shouldBypassUpstashInCurrentEnv()) {
    try {
      const redis = getRedis();
      const key = `healthcheck:alert:${new Date().toISOString().slice(0, 13)}`;
      const res = await redis.set(key, "1", {
        nx: true,
        ex: Number.isFinite(dedupeSeconds) && dedupeSeconds > 0 ? dedupeSeconds : 21600,
      });
      shouldSend = res === "OK";
    } catch {
      shouldSend = true;
    }
  }

  if (!shouldSend) return false;

  const text = buildAlertBody(report);
  await sendMonitoringMail({
    to: alertTo,
    subject: "iNrCy — Alerte healthcheck infra",
    text,
    html: `<pre>${text}</pre>`,
  });
  return true;
}

async function shouldEmitFailureLog(
  report: Awaited<ReturnType<typeof runDeepHealthChecks>>,
) {
  if (shouldBypassUpstashInCurrentEnv()) return true;

  const failures = Object.entries(report.checks)
    .filter(([, check]) => !check.ok)
    .map(([name, check]) => ({ name, error: check.error || null }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(failures))
    .digest("hex")
    .slice(0, 20);
  const configuredSeconds = Number(
    optionalEnv("HEALTHCHECK_FAILURE_LOG_DEDUPE_SECONDS", "3600"),
  );
  const dedupeSeconds = Number.isFinite(configuredSeconds)
    ? Math.min(24 * 60 * 60, Math.max(5 * 60, Math.floor(configuredSeconds)))
    : 3600;

  try {
    const result = await getRedis().set(
      `healthcheck:failure-log:${fingerprint}`,
      "1",
      { nx: true, ex: dedupeSeconds },
    );
    return result === "OK";
  } catch {
    return true;
  }
}

export const GET = withApi(async (req) => {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const report = await runDeepHealthChecks();
  let alertSent = false;

  if (!report.ok) {
    try {
      alertSent = await sendFailureAlert(report);
    } catch (error) {
      const alertLog = isTxSmtpCircuitOpenError(error) ? log.info : log.error;
      alertLog("cron_health_alert_failed", {
        route: "/api/cron/health",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const failureDetails = {
      route: "/api/cron/health",
      checks: report.checks,
      total_ms: report.total_ms,
      alert_sent: alertSent,
    };
    if (await shouldEmitFailureLog(report)) {
      log.error("cron_health_failed", failureDetails);
    } else {
      log.info("cron_health_failure_deduplicated", failureDetails);
    }
  } else {
    log.info("cron_health_ok", {
      route: "/api/cron/health",
      total_ms: report.total_ms,
      media_pipeline: report.checks.media_pipeline,
    });
  }

  return NextResponse.json(
    {
      ...report,
      alert_sent: alertSent,
    },
    { status: report.ok ? 200 : 503 }
  );
}, { route: "/api/cron/health" });
