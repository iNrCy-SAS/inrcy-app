import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import ts from "typescript";
import { catalogTranslator } from "../helpers/catalog-translator.mts";
import { userFacingErrorsFixture as errors } from "../helpers/user-facing-errors-fixture.mts";
import type { AppLocale } from "../../i18n/config.ts";

const require = createRequire(import.meta.url);
// A transpiled controller and React state slots contain heterogeneous values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
type Model = Record<string, Value>;
const locales: AppLocale[] = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const code = ts.transpileModule(readFileSync(new URL("../../app/dashboard/settings/_components/MailsSettingsContent.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function controller(query: string, locale: AppLocale = "fr-FR") {
  const slots: Value[] = [];
  const effects: Array<() => unknown> = [];
  const calls: string[] = [];
  let cursor = 0;
  let model: Model = {};
  const hooks = {
    ...React,
    useState(initial: Value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: Value) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => unknown) => { effects.push(fn); },
  };
  const t = catalogTranslator("mails", locale);
  const window = {
    location: { href: `https://app.example.test/dashboard?${query}#keep` },
    history: { replaceState(_state: unknown, _title: string, href: string) { window.location.href = href; } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    dispatchEvent() {},
  };
  const fixture = { exports: {} as Model };
  const stub = (props: Model) => React.createElement("div", {}, props.children);
  new Function("module", "exports", "require", "window", "fetch", code)(fixture, fixture.exports, (name: string) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next-intl") return { useLocale: () => locale, useTranslations: () => t };
    if (name.endsWith("userFacingErrors")) return errors;
    if (name.endsWith("channel-workspace-snapshot")) return { readChannelWorkspaceSnapshot: () => [], writeChannelWorkspaceSnapshot() {} };
    if (name === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => "fixture-account" };
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.endsWith("ChannelParametersDialog")) return { __esModule: true, default: stub };
    if (name === "@/lib/inrcyDialog") return { confirmInrcy: async () => true };
    throw new Error(`Unexpected dependency: ${name}`);
  }, window, async (url: string) => { calls.push(url); return { ok: true, json: async () => ({ mailAccounts: [] }) }; });
  return {
    t, window, calls,
    render() { cursor = 0; fixture.exports.default({ renderBubble: (next: Model) => { model = next; return null; } }); return model; },
    async flush() { for (const effect of effects.splice(0)) effect(); await new Promise(setImmediate); },
  };
}

for (const locale of locales) {
  for (const provider of ["microsoft", "google"] as const) {
    test(`${locale} ${provider}: callback failure remains visible after mailbox refresh without exposing diagnostics`, async () => {
      const h = controller(`panel=mails&view=keep&linked=${provider}&ok=0&error=oauth_callback_failed&message=PRIVATE_TOKEN%3Dsecret&code=secret-code&state=secret-state`, locale);
      h.render(); await h.flush();
      const model = h.render();
      assert.equal(model.error, h.t("mail_oauth_failed", { provider: provider === "microsoft" ? "Microsoft" : "Gmail" }));
      assert.equal(model.notice, null);
      assert.equal(model.loading, false);
      assert.doesNotMatch(model.error, /PRIVATE|secret|oauth_callback_failed|LinkedIn/i);
      const url = new URL(h.window.location.href);
      assert.equal(url.search, "?panel=mails&view=keep");
      assert.equal(url.hash, "#keep");
      assert.deepEqual(h.calls, ["/api/integrations/status", "/api/inrsend/signature"], "Feedback never retries OAuth or connects a mailbox automatically");
    });
  }

  test(`${locale}: cancellation, expired state, session and configuration use safe localized copy`, async () => {
    for (const [query, expected] of [
      ["linked=microsoft&ok=0&error=access_denied&message=PRIVATE", errors.getLocalizedErrorMessage({ code: "access_denied" }, locale)],
      ["toast=oauth_state", catalogTranslator("mails", locale)("mail_oauth_expired")],
      ["linked=google&ok=0&error=state_mismatch&toast=connected", catalogTranslator("mails", locale)("mail_oauth_expired")],
      ["linked=microsoft&ok=0&error=not_authenticated", errors.getLocalizedErrorMessage({ code: "session_expired" }, locale)],
      ["linked=microsoft&ok=0&error=microsoft_oauth_configuration_error", catalogTranslator("mails", locale)("mail_oauth_configuration_failed")],
      ["linked=microsoft&ok=0&error=microsoft_oauth_authorization_expired", catalogTranslator("mails", locale)("mail_oauth_expired")],
      ["ok=0&error=oauth_config_missing", errors.getLocalizedErrorMessage({ code: "oauth_config_missing" }, locale)],
      ["linked=microsoft&ok=0&error=token_exchange_failed&message=invalid_client%20PRIVATE", errors.getLocalizedErrorMessage({ code: "invalid_client" }, locale)],
    ]) {
      const h = controller(`panel=mails&${query}`, locale);
      h.render(); await h.flush();
      assert.equal(h.render().error, expected);
      assert.equal(h.render().notice, null, "A failed Google callback must not keep its stale connected toast");
      assert.doesNotMatch(h.render().error, /PRIVATE|LinkedIn|state_mismatch|oauth_state|invalid_client/i);
    }
  });
}

test("successful Microsoft and Gmail returns announce the saved connection", async () => {
  for (const provider of ["microsoft", "google"]) {
    const h = controller(`panel=mails&linked=${provider}&ok=1`);
    h.render(); await h.flush();
    assert.equal(h.render().error, null);
    assert.equal(h.render().notice, h.t("boite_mail_connectee_vous_pouvez_maintenant_6d472d63"));
  }
});

test("another channel's callback is left for its own controller", async () => {
  const h = controller("panel=mails&linked=facebook&ok=0&error=access_denied&message=PRIVATE");
  const before = h.window.location.href;
  h.render(); await h.flush();
  assert.equal(h.render().error, null);
  assert.equal(h.window.location.href, before);
});

test("generic client configuration errors never claim LinkedIn, while explicit LinkedIn reconnect guidance remains", () => {
  assert.doesNotMatch(errors.getSimpleFrenchErrorMessage("invalid client secret"), /LinkedIn/);
  assert.equal(errors.getSimpleFrenchErrorMessage("invalid_client"), errors.getSimpleFrenchErrorMessage({ status: 503 }));
  assert.equal(errors.getSimpleFrenchErrorMessage("LinkedIn OAuth access token expired"), errors.LINKEDIN_RECONNECT_USER_MESSAGE);
});
