import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(file: string, dependencies: Record<string, unknown> = {}): Record<string, unknown> {
  const exports = {};
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)((name: string) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected test dependency: ${name}`);
  }, exports);
  return exports;
}
const appLanguage = load("lib/appLanguage.ts");
const errors = load("lib/userFacingErrors.ts", {
  "@/lib/appLanguage": appLanguage,
  "@/lib/publicationErrorFrench": load("lib/publicationErrorFrench.ts"),
  "@/lib/metaGraphErrorClassification": load("lib/metaGraphErrorClassification.ts"),
}) as typeof import("../../lib/userFacingErrors.ts");
const { getLocalizedErrorMessage: message, getLocalizedApiError: apiError, getSimpleFrenchErrorMessage: french } = errors;
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];

test("all nine full application locales produce distinct localized client errors", () => {
  const normalize = appLanguage.normalizeAppLanguage as (value: unknown) => string;
  assert.deepEqual(locales.map(normalize), ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"]);
  assert.equal(normalize("en_US"), "en");
  assert.equal(normalize("English"), "en");
  assert.equal(normalize("not-a-language"), "fr");
  const outputs = locales.map(locale => message(new TypeError("Failed to fetch"), locale));
  assert.equal(new Set(outputs).size, 9);
  assert.match(outputs[0], /Connexion/);
  assert.match(outputs[1], /connect to the server/);
  for (const output of outputs) assert.doesNotMatch(output, /Failed to fetch|TypeError/);
});

test("credit balance and period limits never suggest a rate-limit retry", () => {
  for (const locale of locales) {
    const credit = message({ code: "AI_MEDIA_QUOTA_REACHED" }, locale);
    const plan = message({ error_code: "ai_quota_reached" }, locale);
    const rate = message({ status: 429 }, locale);
    assert.notEqual(credit, rate); assert.notEqual(plan, rate); assert.notEqual(credit, plan);
    assert.equal(message({ error: { code: "insufficient_credits", message: "provider unavailable" } }, locale), credit);
  }
  assert.match(message({ code: "AI_MEDIA_QUOTA_REACHED" }, "fr-FR"), /solde.*recharge/);
  assert.match(message({ code: "ai_quota_reached" }, "en-GB"), /renewal date/);
  assert.match(message({ code: "ai_quota_unavailable" }, "fr-FR"), /indisponible/);
});

test("explicit machine codes override reused public copy without changing field guidance or channel reconnection", () => {
  for (const locale of locales) {
    const credits = message({ code: "INSUFFICIENT_CREDITS" }, locale);
    const frenchService = message({ status: 503 }, "fr-FR");
    const localizedService = message({ status: 503 }, locale);
    for (const copy of [frenchService, localizedService]) {
      assert.equal(message({ code: "INSUFFICIENT_CREDITS", error: copy, status: 429 }, locale), credits);
      assert.equal(message({ error: { error_code: "INSUFFICIENT_CREDITS", message: copy }, status: 429 }, locale), credits);
      assert.equal(message({ errorCode: "INSUFFICIENT_CREDITS", message: copy, status: 429 }, locale), credits);
    }
    const channel = "Facebook OAuthException Invalid OAuth access token";
    assert.notEqual(message({ error: channel, status: 401 }, locale), message({ code: "session_expired" }, locale));
    assert.equal(message({ error: channel, status: 401 }, locale), message(channel, locale));
  }
  const field = "Le fichier doit contenir au maximum 500 lignes. Corrigez-le puis réessayez.";
  assert.equal(message({ error: field, status: 422 }, "fr-FR"), field);
});

test("unknown diagnostics and unsafe fallbacks never expose secrets, code, HTML or stacks", () => {
  const diagnostics = [
    "{\"error\":\"private-provider-response\",\"secret\":\"sensitive-example\"}",
    "TypeError: internal failure at /var/app/private.ts:45:9",
    "Error: fetch https://assets.example.test/video?X-Amz-Signature=sensitive-example",
    "Authorization: Bearer sensitive-example",
    "api_key=sensitive-example",
    "ai_media_private_operation_failed",
    "PGRST116: JSON object requested, multiple rows returned",
    "<!doctype html><html>private upstream error</html>",
  ];
  for (const locale of locales) for (const diagnostic of diagnostics) {
    const result = message(diagnostic, locale);
    assert.doesNotMatch(result, /sensitive-example|private|PGRST|TypeError|<html|api_key|ai_media|\/var\/|https:/i);
    assert.ok(result.length > 10);
  }
  assert.doesNotMatch(message(null, "fr", "client_secret=sensitive-example"), /sensitive-example/);
  const cycle: { error?: unknown } = {}; cycle.error = cycle;
  assert.equal(message(cycle, "en-GB"), message(null, "en-GB"));
});

test("safe field guidance and translated caller messages retain actionable details", () => {
  const guidance = "Le fichier doit contenir au maximum 500 lignes. Corrigez-le puis réessayez.";
  assert.equal(french(guidance), guidance);
  assert.equal(message(guidance, "fr-FR"), guidance);
  const english = "Choose a destination board before saving this publication.";
  assert.equal(message(new Error(english), "en-GB", english), english);
  const spanish = "Selecciona una imagen antes de continuar.";
  assert.equal(message(new Error(spanish), "es-ES", spanish), spanish);
  assert.equal(message("unknown_provider_response", "es-ES", spanish), spanish);
  assert.doesNotMatch(message("Upstream answer cannot complete this operation", "fr-FR"), /Upstream|cannot/);
  assert.doesNotMatch(message("A problem occurred during processing", "fr-FR"), /problem|occurred|processing/);
  assert.equal(message("La publication doit comporter au moins une image.", "en-GB", english), english);
});

test("file errors offer a useful correction and opaque one-segment codes never become customer copy", () => {
  for (const locale of locales) {
    const tooLarge = message({ status: 413 }, locale);
    const badFormat = message({ status: 415 }, locale);
    assert.notEqual(tooLarge, message(null, locale));
    assert.notEqual(badFormat, message(null, locale));
    assert.notEqual(tooLarge, badFormat);
    assert.equal(message(new Error("File is too large"), locale), tooLarge);
  }
  for (const raw of ["NOT_FOUND", "unauthenticated", "Bad Gateway", "Gateway Timeout", "workspace_missing"]) {
    assert.notEqual(message(raw, "fr-FR").toLowerCase(), raw.toLowerCase());
  }
});

test("numeric identifiers do not masquerade as HTTP status codes", () => {
  const guidance = "La facture INV-503-401-429 est déjà enregistrée. Ouvrez-la pour la modifier.";
  assert.equal(message(guidance, "fr-FR"), guidance);
  assert.doesNotMatch(message("operation_5030123_failed", "fr-FR"), /session|sollicité|indisponible/);
  assert.match(message("HTTP 401", "en-GB"), /sign in again/);
});

test("strict provider boundaries honor explicit HTTP status while ordinary public field guidance remains intact", () => {
  const input = { error: "Crédits indisponibles", status: 503 };
  for (const locale of locales) {
    assert.equal(message(input, locale, undefined, { allowUnknownMessage: false }), message({ status: 503 }, locale));
  }
  assert.equal(message(input, "fr-FR"), input.error);
  const guidance = { error: "Le fichier doit contenir au maximum 500 lignes.", status: 422 };
  assert.equal(message(guidance, "fr-FR"), guidance.error);
  assert.equal(message(guidance, "fr-FR", undefined, { allowUnknownMessage: false }), message({ status: 422 }, "fr-FR"));
  assert.equal(message({ error: "Facture INV-503-401-429 introuvable" }, "fr-FR", undefined, { allowUnknownMessage: false }), message({ status: 404 }, "fr-FR"));
});

test("auth, permissions and reconnect guidance stays localized and idempotent", () => {
  for (const locale of locales) {
    for (const input of [{ status: 401 }, { status: 403 }, { code: "email_not_confirmed" }, { code: "otp_expired" }, { message: "Facebook OAuth access token expired", status: 403 }]) {
      const output = message(input, locale);
      assert.equal(message(new Error(output), locale), output);
      assert.doesNotMatch(output, /OAuth|access token|403|401/);
    }
    assert.equal(message({ code: "invalid_client" }, locale), message({ status: 503 }, locale));
    assert.equal(message("Client authentication failed", locale), message({ status: 503 }, locale));
  }
  assert.match(message({ message: "Facebook OAuth access token expired", status: 403 }, "en-GB"), /Facebook.*Channels/);
});

test("API errors use structured codes and response status without consuming the body", async () => {
  const response = new Response(JSON.stringify({ error: { message: "private provider details" }, code: "AI_MEDIA_QUOTA_REACHED" }), { status: 429, headers: { "Content-Type": "application/json" } });
  const output = await apiError(response, "en-GB");
  assert.match(output, /credits.*balance/);
  assert.doesNotMatch(output, /private/);
  assert.equal(response.bodyUsed, false);
  assert.equal((await response.json()).code, "AI_MEDIA_QUOTA_REACHED");
  const html = new Response("<html>secret upstream failure</html>", { status: 503, headers: { "Content-Type": "text/html" } });
  assert.match(await apiError(html, "en-GB"), /temporarily unavailable/);
  const invalidJson = new Response("{broken", { status: 401, headers: { "Content-Type": "application/json" } });
  assert.match(await apiError(invalidJson, "es-ES"), /iniciar sesión/);
});
