import assert from "node:assert/strict";
import test from "node:test";
import { createAdsApiRequestError, readJson, readAdsConnectionStatus } from "../app/dashboard/ads/adsClientHttp.ts";
import { adsErrorRuntime } from "./helpers/ads-error-message-runtime.mts";
import { adsComponentModules } from "./helpers/ads-component-runtime.mts";
import { adsPublicErrorMessageKey } from "../app/dashboard/ads/adsPublicErrorMessages.ts";
import type { AppLocale } from "../i18n/config.ts";

const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const fallback = "shell.ads_error_20d50de173";
for (const locale of locales) {
  test(`${locale}: ADS renders a translated action fallback without provider diagnostics`, () => {
    const format = adsErrorRuntime(locale).useAdsErrorMessage();
    const safe = format(null, fallback);
    assert.ok(safe.length > 5);
    for (const input of [new Error("SQL relation campaigns does not exist at /srv/secret.js:23\n token=secret"), { error: "opaque_provider_123", requestId: "secret-trace", raw: { api_key: "secret" } }, "Unexpected provider failure: https://signed.test/file?token=secret", "Erreur interne du fournisseur non classée"]) {
      assert.equal(format(input, fallback), safe);
      assert.doesNotMatch(format(input, fallback), /secret|opaque_provider|SQL|https?:/);
    }
  });
  test(`${locale}: ADS keeps actionable quota and HTTP classifications`, () => {
    const format = adsErrorRuntime(locale).useAdsErrorMessage();
    const generic = format(null, fallback);
    const quota = createAdsApiRequestError({ error: "opaque_provider_123", code: "INSUFFICIENT_CREDITS", requestId: "trace-1" }, 402);
    assert.notEqual(format(quota, fallback), generic);
    assert.notEqual(format(createAdsApiRequestError({ error: "opaque_provider_123" }, 401), fallback), generic);
    assert.notEqual(format(createAdsApiRequestError({ error: "opaque_provider_123" }, 429), fallback), generic);
    assert.notEqual(format(quota, fallback), format(createAdsApiRequestError({}, 429), fallback));
    for (const payload of [{ error: "opaque-provider", error_code: "INSUFFICIENT_CREDITS" }, { error: { message: "opaque-provider", code: "INSUFFICIENT_CREDITS" } }]) {
      const preserved = createAdsApiRequestError(payload, 429);
      assert.equal(preserved.code, "INSUFFICIENT_CREDITS");
      assert.equal(format(preserved, fallback), format(quota, fallback));
      assert.deepEqual(preserved.cause, payload);
    }
    for (const status of [401, 403, 429, 503]) assert.equal(format(createAdsApiRequestError({}, status), fallback), format(createAdsApiRequestError({ error: "opaque-provider" }, status), fallback), "an empty response body must retain the explicit HTTP classification");
  });
  test(`${locale}: ADS preserves reviewed draft and identity guidance without exposing unknown provider text`, () => {
    const format = adsErrorRuntime(locale).useAdsErrorMessage();
    const translate = adsComponentModules(locale as AppLocale)["next-intl"].useTranslations();
    const messages = [
      "Le compte ou les identités TikTok ont changé. Relisez la proposition actualisée avant de valider.",
      "Le brouillon précédent a été enregistré. Vos nouvelles modifications restent à valider ; aucune publicité n’a été créée.",
      "L’enregistrement du brouillon n’a pas été confirmé.",
      "LinkedIn ne prend pas en charge la langue et le pays sélectionnés.",
      "Une autorisation LinkedIn manque. Reconnectez le compte pour actualiser ses droits.",
      "ChatGPT Ads attend une clé Advertiser API valide et un compte approuvé avant toute création.",
    ];
    for (const message of messages) {
      const key = adsPublicErrorMessageKey(message);
      assert.ok(key, "reviewed exact copy must have a catalogue binding");
      assert.equal(format(new Error(message), fallback), translate(key));
      assert.equal(format({ error: { message } }, fallback), translate(key));
      assert.equal(format(new Error(message + " token=secret"), fallback), format(null, fallback));
      assert.doesNotMatch(format(new Error(message + " token=secret"), fallback), /secret|token=/);
    }
    const known = messages[0];
    for (const status of [401, 403, 429, 503]) {
      assert.equal(format(createAdsApiRequestError({ error: known }, status), fallback), format(createAdsApiRequestError({ error: "opaque-provider" }, status), fallback), "explicit HTTP context takes priority over a known sentence");
    }
    assert.equal(format(createAdsApiRequestError({ error: known, code: "INSUFFICIENT_CREDITS" }, 402), fallback), format(createAdsApiRequestError({ error: "opaque-provider", code: "INSUFFICIENT_CREDITS" }, 402), fallback));
    assert.equal(format({ message: known, errorCode: "INSUFFICIENT_CREDITS", status: 429 }, fallback), format(createAdsApiRequestError({ error: "opaque-provider", code: "INSUFFICIENT_CREDITS" }, 402), fallback));
  });
}
test("ADS public-copy matching is exact and bounded for cyclic or unknown payloads", () => {
  const cyclic: Record<string, unknown> = { message: "Provider failure with private details" };
  cyclic.error = cyclic;
  assert.equal(adsPublicErrorMessageKey(cyclic), null);
  assert.equal(adsPublicErrorMessageKey("Budget"), null, "an interface label is not public error guidance");
  assert.equal(adsPublicErrorMessageKey("L’enregistrement du brouillon n’a pas été confirmé. Extra provider details"), null);
});
test("ADS API errors retain non-rendered diagnostics and response metadata", async () => {
  const payload = { error: "provider-stack-secret", code: "ADS_PROVIDER_BUSY", requestId: "trace-42", retryAfter: 60 };
  await assert.rejects(readJson(Response.json(payload, { status: 429 })), (error: unknown) => {
    assert.ok(error instanceof Error);
    const typed = error as ReturnType<typeof createAdsApiRequestError>;
    assert.equal(typed.status, 429);
    assert.equal(typed.code, payload.code);
    assert.equal(typed.requestId, payload.requestId);
    assert.deepEqual(typed.cause, payload);
    assert.equal(Object.keys(typed).includes("cause"), false);
    return true;
  });
  assert.deepEqual(await readJson(Response.json({ campaigns: [] })), { campaigns: [] });
  const revoked = { connected: false, status: "needs_reconnect", error: "token expired" };
  assert.deepEqual(await readAdsConnectionStatus(Response.json(revoked, { status: 401 })), revoked);
});
