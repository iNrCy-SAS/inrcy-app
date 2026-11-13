import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const catalogs = new Map();

/** Check copy used by a source contract without requiring French literals in JSX. */
export function assertUiCopy(namespace, key, french) {
  for (const locale of locales) {
    const id = `${locale}/${namespace}`;
    if (!catalogs.has(id)) {
      catalogs.set(id, JSON.parse(readFileSync(new URL(`../../messages/${id}.json`, import.meta.url), "utf8")));
    }
    const message = catalogs.get(id)[key];
    assert.equal(typeof message, "string", `${id}.${key} must exist`);
    assert.ok(message.trim(), `${id}.${key} must contain copy`);
    if (locale === "fr-FR") assert.equal(message, french, `${namespace}.${key} must preserve its meaning`);
  }
}
