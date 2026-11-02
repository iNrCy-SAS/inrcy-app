import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
  MEDIA_WORKSPACE_READINESS_TIMEOUT_MS,
  MEDIA_WORKSPACE_READ_TIMEOUT_MS,
  MEDIA_WORKSPACE_TIMEOUT_CODE,
  MediaWorkspaceHttpError,
  MediaWorkspaceTimeoutError,
  isMediaWorkspaceRetryableFetchError,
  isMediaWorkspaceRetryableHttpStatus,
  isMediaWorkspacePollingRetryableError,
  withMediaWorkspaceDeadline,
} from "../../lib/mediaWorkspaceTimeout.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("une opération média qui n'aboutit jamais est interrompue avec une erreur FR rejouable", async () => {
  const startedAt = Date.now();

  await assert.rejects(
    withMediaWorkspaceDeadline(
      async () => await new Promise<never>(() => undefined),
      { timeoutMs: 20, phase: "test_readiness" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MediaWorkspaceTimeoutError);
      assert.equal(error.code, MEDIA_WORKSPACE_TIMEOUT_CODE);
      assert.equal(error.retryable, true);
      assert.equal(error.phase, "test_readiness");
      assert.match(error.message, /Supabase.*Réessayez/i);
      return true;
    },
  );

  assert.ok(Date.now() - startedAt < 500, "le test ne doit jamais rester pendant");
});

test("le signal appelant reste prioritaire et n'est jamais transformé en faux timeout", async () => {
  const parent = new AbortController();
  const expected = new DOMException("navigation interrompue", "AbortError");
  const pending = withMediaWorkspaceDeadline(
    async () => await new Promise<never>(() => undefined),
    { signal: parent.signal, timeoutMs: 1_000, phase: "test_parent_abort" },
  );

  parent.abort(expected);
  await assert.rejects(pending, (error: unknown) => error === expected);
});

test("les budgets workspace restent bornés sous le plafond de génération", () => {
  assert.ok(MEDIA_WORKSPACE_READ_TIMEOUT_MS > 0);
  assert.ok(MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS > 0);
  assert.ok(
    MEDIA_WORKSPACE_READ_TIMEOUT_MS <= MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
  );
  assert.ok(MEDIA_WORKSPACE_READINESS_TIMEOUT_MS >= 30_000);
  assert.ok(MEDIA_WORKSPACE_READINESS_TIMEOUT_MS <= 45_000);
});

test("workspace polling retries only timeout, network, 429 and 5xx", () => {
  assert.equal(isMediaWorkspaceRetryableHttpStatus(429), true);
  assert.equal(isMediaWorkspaceRetryableHttpStatus(500), true);
  assert.equal(isMediaWorkspaceRetryableHttpStatus(503), true);
  assert.equal(isMediaWorkspaceRetryableHttpStatus(400), false);
  assert.equal(isMediaWorkspaceRetryableHttpStatus(401), false);
  assert.equal(isMediaWorkspaceRetryableHttpStatus(404), false);

  assert.equal(
    isMediaWorkspaceRetryableFetchError(
      new MediaWorkspaceTimeoutError(undefined, "workspace_read"),
    ),
    true,
  );
  assert.equal(
    isMediaWorkspaceRetryableFetchError(new TypeError("Failed to fetch")),
    true,
  );
  assert.equal(
    isMediaWorkspaceRetryableFetchError(
      new DOMException("navigation interrupted", "AbortError"),
    ),
    false,
  );
  assert.equal(
    isMediaWorkspaceRetryableFetchError(new Error("invalid request")),
    false,
  );

  const permanent = new MediaWorkspaceHttpError(403, "forbidden");
  assert.equal(permanent.status, 403);
  assert.equal(permanent.retryable, false);
  assert.equal(isMediaWorkspacePollingRetryableError(permanent), false);
  assert.equal(
    isMediaWorkspacePollingRetryableError(
      new MediaWorkspaceHttpError(429, "rate limited"),
    ),
    true,
  );
  assert.equal(
    isMediaWorkspacePollingRetryableError(
      new MediaWorkspaceHttpError(502, "gateway"),
    ),
    true,
  );
});

test("every workspace client fetch and readiness use a composable deadline", () => {
  const client = read("lib/mediaWorkspaceClient.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const workspaceHook = read(
    "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
  );

  assert.match(
    client,
    /ensureMediaPublicationWorkspace[\s\S]*withMediaWorkspaceDeadline\([\s\S]*workspace_ensure/,
  );
  assert.match(
    client,
    /clearMediaPublicationWorkspace[\s\S]*withMediaWorkspaceDeadline\([\s\S]*workspace_clear/,
  );
  assert.match(
    client,
    /fetchWorkspaceSnapshotWithRetry[\s\S]*withMediaWorkspaceDeadline\([\s\S]*workspace_read/,
  );
  for (const phase of [
    "workspace_archive",
    "workspace_link_draft",
    "workspace_source_preview",
    "workspace_prepare",
    "workspace_prewarm",
  ]) {
    assert.match(client, new RegExp(`withMediaWorkspaceDeadline\\([\\s\\S]*${phase}`));
  }
  assert.match(client, /isMediaWorkspaceRetryableHttpStatus\(response\.status\)/);
  assert.match(client, /isMediaWorkspaceRetryableFetchError\(error\)/);
  assert.match(client, /throw new MediaWorkspaceHttpError\(/);
  assert.match(workspaceHook, /if \(!isMediaWorkspacePollingRetryableError\(error\)\) throw error/);
  assert.match(
    modal,
    /waitForPersistentWorkspaceReadiness[\s\S]*timeoutMs = MEDIA_WORKSPACE_READINESS_TIMEOUT_MS[\s\S]*withMediaWorkspaceDeadline\([\s\S]*timeoutMs/,
  );
  assert.doesNotMatch([modal, submission].join("\n"), /BOOSTER_HEAVY_VIDEO_WORKSPACE_READINESS_TIMEOUT_MS/);
  assert.match(
    submission,
    /publishWorkspaceReadinessTimeoutMs\s*=\s*[\r\n\s]*MEDIA_WORKSPACE_READINESS_TIMEOUT_MS[\s\S]*waitForPersistentWorkspaceReadiness\([\s\S]*"publish"[\s\S]*publishWorkspaceReadinessTimeoutMs/,
  );
  assert.match(
    submission,
    /scheduleWorkspaceReadinessTimeoutMs\s*=\s*[\r\n\s]*MEDIA_WORKSPACE_READINESS_TIMEOUT_MS[\s\S]*waitForPersistentWorkspaceReadiness\([\s\S]*"schedule"[\s\S]*scheduleWorkspaceReadinessTimeoutMs/,
  );
});

test("un statut workspace identique est un vrai no-op SQL et les refresh redondants sont supprimés", () => {
  const server = read("lib/mediaWorkspaceServer.ts");
  const intent = read("app/api/media-pipeline/upload-intent/route.ts");
  const event = read("app/api/media-pipeline/upload-event/route.ts");

  assert.match(server, /\.update\(\{ status: nextStatus \}\)/);
  assert.match(server, /\.neq\("status", nextStatus\)/);
  assert.doesNotMatch(server, /last_opened_at/);

  assert.equal(
    intent.match(/refreshPublicationWorkspaceMediaStatus\(\{/g)?.length,
    1,
    "l'intent ne doit agréger le statut qu'une fois après l'attachement",
  );
  assert.match(event, /if \(event !== "uploading"\)[\s\S]*refreshPublicationWorkspaceStatusesForMedia/);
});
