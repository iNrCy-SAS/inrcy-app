import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React, { type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as limits from "../../lib/aiMediaPlanLimits.ts";
import { STANDARD_PUBLICATION_CHANNEL_KEYS } from "../../lib/dashboardEdition.ts";
import { APP_LOCALES, type AppLocale } from "../../i18n/config.ts";
import { catalogTranslator } from "../helpers/catalog-translator.mts";

const nodeRequire = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../../app/dashboard/settings/_components/SubscriptionComparison.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Comparison = Record<"SubscriptionPlanFeatures" | "SubscriptionQuotaSummary", ComponentType<{ edition: limits.AiMediaEdition }>>;

function comparison(locale: AppLocale): Comparison {
  const record = { exports: {} as Comparison };
  new Function("module", "exports", "require", source)(record, record.exports, (name: string) => {
    if (name === "react/jsx-runtime") return nodeRequire(name);
    if (name === "next-intl") return { useTranslations: (namespace: string) => catalogTranslator(namespace, locale) };
    if (name === "@/lib/aiMediaPlanLimits") return limits;
    if (name === "@/lib/dashboardEdition") return { STANDARD_PUBLICATION_CHANNEL_KEYS };
    if (name === "./SubscriptionWorkspace") return { SubscriptionDetails: ({ children }: { children: React.ReactNode }) => children };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
    throw new Error(`Unexpected subscription dependency: ${name}`);
  });
  return record.exports;
}

for (const locale of APP_LOCALES) test(`Mon abonnement renders 50 Basic credits and unchanged higher offers in ${locale}`, () => {
  const components = comparison(locale);
  const t = catalogTranslator("settings", locale);
  for (const [edition, expected] of [["basic", 50], ["standard", 735], ["premium", 2530], ["founder", 1390]] as const) {
    for (const Component of Object.values(components)) {
      const markup = renderToStaticMarkup(React.createElement(Component, { edition }));
      assert.ok(markup.includes(`<strong>${expected}</strong>`), `${edition}: ${markup}`);
      assert.ok(markup.includes(renderToStaticMarkup(React.createElement("span", null, t("subscription_media_month_label")))));
      if (edition === "basic") {
        assert.ok(markup.includes(renderToStaticMarkup(React.createElement("small", null, t("subscription_basic_credit_hint")))));
      }
    }
  }
});
