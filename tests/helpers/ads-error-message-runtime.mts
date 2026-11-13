import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

function load(file: string, dependencies: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)((name: string) => {
    assert.ok(name in dependencies, `Unexpected ADS test dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const errors = load("lib/userFacingErrors.ts", {
  "@/lib/appLanguage": load("lib/appLanguage.ts"),
  "@/lib/publicationErrorFrench": load("lib/publicationErrorFrench.ts"),
  "@/lib/metaGraphErrorClassification": load("lib/metaGraphErrorClassification.ts"),
});
const cached = new Map<string, { useAdsErrorMessage: () => (input: unknown, key: string, values?: Record<string, string | number>) => string }>();

/** The real hook and public classifier, with only React/Intl context isolated. */
export function adsErrorRuntime(locale = "fr-FR") {
  if (cached.has(locale)) return cached.get(locale)!;
  const catalogs = new Map<string, Record<string, string>>();
  const translate = (key: string, values = {}) => {
    const [namespace, ...parts] = key.split(".");
    if (!catalogs.has(namespace)) catalogs.set(namespace, JSON.parse(readFileSync(new URL(`../../messages/${locale}/${namespace}.json`, import.meta.url), "utf8")));
    const text = catalogs.get(namespace)![parts.join(".")];
    assert.equal(typeof text, "string", `${locale}: missing ${key}`);
    return new IntlMessageFormat(text, locale).format(values) as string;
  };
  const hook = load("app/dashboard/ads/useAdsErrorMessage.ts", {
    react: { useCallback: (callback: unknown) => callback, useRef: (current: unknown) => ({ current }), useLayoutEffect: (effect: () => void) => effect() },
    "next-intl": { useLocale: () => locale, useTranslations: () => translate },
    "@/lib/userFacingErrors": errors,
    "./adsPublicErrorMessages": load("app/dashboard/ads/adsPublicErrorMessages.ts"),
  }) as { useAdsErrorMessage: () => (input: unknown, key: string, values?: Record<string, string | number>) => string };
  const format = hook.useAdsErrorMessage();
  const runtime = { useAdsErrorMessage: () => format };
  cached.set(locale, runtime);
  return runtime;
}

/** Real safe client fallback used by UI fixtures that do not mount Intl hooks. */
export const getClientUserFacingErrorMessage = errors.getClientUserFacingErrorMessage as (input: unknown, fallback: string) => string;
