import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createTranslator } from "next-intl";
import ts from "typescript";
import type { AppLocale } from "../../i18n/config.ts";
import * as http from "../../app/dashboard/ads/adsClientHttp.ts";
import { adsErrorRuntime } from "./ads-error-message-runtime.mts";

const uiModule = { exports: {} as typeof import("../../app/dashboard/ads/adsUiCopy.ts") };
const source = readFileSync(new URL("../../app/dashboard/ads/adsUiCopy.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function("module", "exports", "require", code)(uiModule, uiModule.exports, (name: string) => assert.fail(`Unexpected ADS copy dependency: ${name}`));
const cache = new Map<AppLocale, { useLocale: () => AppLocale; useTranslations: (namespace?: string) => ReturnType<typeof createTranslator> }>();

/** Real catalogues and production copy/error adapters, with only Intl context isolated.
 * Translator identities stay stable so lifecycle tests retain their real effect gates. */
export function adsComponentModules(locale: AppLocale = "fr-FR") {
  if (!cache.has(locale)) {
    const directory = new URL(`../../messages/${locale}/`, import.meta.url);
    const messages = Object.fromEntries(readdirSync(directory).filter(file => file.endsWith(".json")).map(file => [file.slice(0, -5), JSON.parse(readFileSync(new URL(file, directory), "utf8"))]));
    const translators = new Map<string, ReturnType<typeof createTranslator>>();
    cache.set(locale, { useLocale: () => locale, useTranslations: (namespace = "") => {
      if (!translators.has(namespace)) translators.set(namespace, createTranslator({ locale, messages, ...(namespace ? { namespace } : {}), onError: error => { throw error; } }));
      return translators.get(namespace)!;
    } });
  }
  return { "next-intl": cache.get(locale)!, "./adsUiCopy": uiModule.exports, "./adsClientHttp": http, "./useAdsErrorMessage": adsErrorRuntime(locale) };
}
