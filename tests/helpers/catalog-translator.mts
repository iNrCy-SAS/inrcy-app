import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import type { AppLocale } from "../../i18n/config.ts";

/** Real catalogue and ICU formatting; missing keys fail isolated UI contracts. */
export function catalogTranslator(namespace: string, locale: AppLocale = "fr-FR") {
  const rootNamespace = namespace.split(".")[0];
  const messages = { [rootNamespace]: JSON.parse(readFileSync(new URL(`../../messages/${locale}/${rootNamespace}.json`, import.meta.url), "utf8")) };
  return createTranslator({ locale, messages, namespace, onError: error => { throw error; } });
}
