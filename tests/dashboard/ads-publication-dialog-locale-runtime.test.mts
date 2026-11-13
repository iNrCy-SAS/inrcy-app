import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { adsComponentModules } from "../helpers/ads-component-runtime.mts";
import { nextAdsPublicationProgress } from "../../lib/adsPublicationProgress.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../app/dashboard/ads/AdsCampaignDemoDialog.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;

test("real publication dialog uses the current language during both waiting phases, without unlocking a second submission", () => {
  for (const locale of locales) {
    const modules = adsComponentModules(locale);
    const exports = {} as { default: React.ComponentType<Record<string, unknown>> };
    new Function("exports", "require", "document", code)(exports, (name: string) => {
      if (name in modules) return modules[name as keyof typeof modules];
      if (name === "react-dom") return { createPortal: (children: React.ReactNode) => children };
      if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (name === "@/lib/adsPublicationProgress") return { nextAdsPublicationProgress };
      return require(name);
    }, { body: {} });
    const t = modules["next-intl"].useTranslations("booster");
    for (const phase of ["saving", "sending"] as const) {
      const markup = renderToStaticMarkup(React.createElement(exports.default, {
        mode: "confirm", busy: true, publicationPhase: phase,
        details: { campaignName: "USER NAME · Bonjour", channelLabel: "Google Ads", accountName: "USER ACCOUNT", accountId: "123", dailyBudgetEuros: 123.45, endDate: "2026-12-24" },
        declarationLabel: "USER DECLARATION", declarationChecked: true,
        launchStatus: "active", activeEnabled: true, pausedEnabled: true,
        onConfirm() { assert.fail("Rendering must never submit"); },
      }));
      const progressLabel = t(phase === "saving" ? "wizard_step_channels" : "ads_sending");
      const aria = t("value_en_cours_progression_indicative_value_12676698", { value0: progressLabel, value1: phase === "saving" ? 1 : 12 });
      assert.ok(markup.includes(String(progressLabel)), locale + "/" + phase);
      assert.ok(markup.includes(`aria-label="${aria}"`), locale + "/" + phase);
      assert.match(markup, /aria-busy="true"[^>]*disabled=""/);
      assert.ok(markup.includes((123.45).toLocaleString(locale, { style: "currency", currency: "EUR" })));
      assert.ok(markup.includes("USER NAME · Bonjour"));
      if (locale !== "fr-FR") assert.doesNotMatch(markup, />Envoi…/);
    }
  }
});
