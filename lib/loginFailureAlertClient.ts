"use client";

import {
  classifyLoginError,
  getLoginAuthErrorCode,
  getLoginAuthErrorStatus,
  type LoginErrorKind,
} from "./loginAuthError.ts";

const LOGIN_FAILURE_ALERT_ENDPOINT = "/api/public/login-failure-alert";

export type LoginFailureAlertPayload = {
  kind: "failure";
  email: string;
  error_code: string | null;
  error_status: number | null;
  category: LoginErrorKind;
};

export type LoginSuccessAlertPayload = {
  kind: "success";
};

type LoginAlertPayload = LoginFailureAlertPayload | LoginSuccessAlertPayload;
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<unknown>;

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase().slice(0, 320);
}

export function buildLoginFailureAlertPayload(input: {
  email: unknown;
  error: unknown;
}): LoginFailureAlertPayload | null {
  const email = normalizeEmail(input.email);
  if (!email) return null;

  return {
    kind: "failure",
    email,
    error_code: getLoginAuthErrorCode(input.error),
    error_status: getLoginAuthErrorStatus(input.error),
    category: classifyLoginError(input.error),
  };
}

async function postLoginAlert(payload: LoginAlertPayload, fetchImpl: FetchLike) {
  try {
    await fetchImpl(LOGIN_FAILURE_ALERT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch {
    // Observability is best-effort and must never affect authentication.
  }
}

export async function reportLoginFailure(
  input: { email: unknown; error: unknown },
  fetchImpl: FetchLike = fetch,
) {
  try {
    const payload = buildLoginFailureAlertPayload(input);
    if (!payload) return;
    await postLoginAlert(payload, fetchImpl);
  } catch {
    // Even malformed third-party errors must stay invisible to the login flow.
  }
}

export async function reportLoginSuccess(fetchImpl: FetchLike = fetch) {
  try {
    await postLoginAlert({ kind: "success" }, fetchImpl);
  } catch {
    // The authenticated session remains authoritative if telemetry is unavailable.
  }
}
