import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyLoginError,
  getLoginAuthErrorCode,
  getLoginAuthErrorStatus,
} from "../../lib/loginAuthError.ts";
import {
  buildLoginFailureAlertPayload,
  reportLoginFailure,
  reportLoginSuccess,
} from "../../lib/loginFailureAlertClient.ts";

test("les codes Supabase stables priment sur les textes de repli", () => {
  assert.equal(
    classifyLoginError({
      code: "invalid_credentials",
      message: "Internal server error",
      status: 400,
    }),
    "invalidCredentials",
  );
  assert.equal(
    classifyLoginError({
      code: "email_not_confirmed",
      message: "Invalid login credentials",
      status: 400,
    }),
    "emailUnconfirmed",
  );
  assert.equal(
    classifyLoginError({ code: "otp_expired", message: "Unknown error" }),
    "linkUnavailable",
  );
  assert.equal(
    classifyLoginError({ code: "session_not_found", message: "Unknown error" }),
    "storage",
  );
});

test("les anciens textes conservent exactement les catégories de l'interface", () => {
  assert.equal(classifyLoginError(new Error("Invalid login credentials")), "invalidCredentials");
  assert.equal(classifyLoginError(new Error("Email not confirmed")), "emailUnconfirmed");
  assert.equal(classifyLoginError(new Error("Email link is invalid")), "linkUnavailable");
  assert.equal(classifyLoginError(new TypeError("Failed to fetch")), "network");
  assert.equal(classifyLoginError(new Error("Auth session missing")), "storage");
  assert.equal(
    classifyLoginError({ status: 503, message: "Invalid login credentials" }),
    "invalidCredentials",
  );
  assert.equal(classifyLoginError({ status: 503, message: "Unavailable" }), "service");
  assert.equal(classifyLoginError(new Error("Something else")), "technical");
});

test("seuls un code et un statut Supabase bornés peuvent quitter le navigateur", () => {
  assert.equal(getLoginAuthErrorCode({ code: " INVALID_CREDENTIALS " }), "invalid_credentials");
  assert.equal(getLoginAuthErrorCode({ code: "invalid_credentials\npassword=secret" }), null);
  assert.equal(getLoginAuthErrorStatus({ status: "400" }), 400);
  assert.equal(getLoginAuthErrorStatus({ status: "400avec-du-texte" }), null);
  assert.equal(getLoginAuthErrorStatus({ status: 999 }), null);
});

test("le payload d'échec exclut tout mot de passe, jeton et message brut", () => {
  const payload = buildLoginFailureAlertPayload({
    email: "  Client@Example.com ",
    error: {
      code: "invalid_credentials",
      status: 400,
      message: "Invalid login credentials; password=SuperSecret! token=abc123",
      password: "SuperSecret!",
      token: "abc123",
    },
  });

  assert.deepEqual(payload, {
    kind: "failure",
    email: "client@example.com",
    error_code: "invalid_credentials",
    error_status: 400,
    category: "invalidCredentials",
  });

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /password|token|SuperSecret|abc123|Invalid login/i);
});

test("l'envoi d'échec utilise keepalive et reste best-effort", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  await reportLoginFailure(
    {
      email: "client@example.com",
      error: { code: "invalid_credentials", status: 400 },
    },
    async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return { ok: true };
    },
  );

  assert.equal(requestUrl, "/api/public/login-failure-alert");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.credentials, "same-origin");
  assert.equal(requestInit?.keepalive, true);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    kind: "failure",
    email: "client@example.com",
    error_code: "invalid_credentials",
    error_status: 400,
    category: "invalidCredentials",
  });

  await assert.doesNotReject(
    reportLoginFailure(
      { email: "client@example.com", error: new Error("Failed to fetch") },
      async () => {
        throw new Error("telemetry unavailable");
      },
    ),
  );
});

test("le succès repose sur la session et ne transmet aucune identité", async () => {
  let body = "";
  await reportLoginSuccess(async (_url, init) => {
    body = String(init?.body || "");
    return { ok: true };
  });

  assert.deepEqual(JSON.parse(body), { kind: "success" });
  assert.doesNotMatch(body, /email|password|token/i);
});

test("la page de connexion signale les refus et seulement les succès confirmés", () => {
  const source = readFileSync("app/login/page.tsx", "utf8");
  assert.match(source, /void reportLoginFailure\(\{ email, error: signInError \}\)/);
  assert.match(source, /if \(signInThrew\) throw signInError;/);
  assert.equal(source.match(/void reportLoginSuccess\(\)/g)?.length, 2);
  assert.match(source, /const serverSessionReady = await waitForServerAuthSession\(\)/);
});
