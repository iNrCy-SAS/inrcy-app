import fs from "node:fs";
import path from "node:path";
import {parse} from "@formatjs/icu-messageformat-parser";

const root = process.cwd();
// Catalog values are rendered as text. Encoded HTML entities would leak to
// the interface instead of being interpreted by the browser.
const renderedHtmlEntity = /&(?:[a-z][a-z0-9]+|#x?[0-9a-f]+);/iu;
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT"];
const namespaces = fs.readdirSync(path.join(root, "messages", "fr-FR"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.basename(name, ".json"))
  .sort();
const mojibake = /(?:Ã.|Â.|â€|â€™|â€œ|â€�|â€¦|ï¿½|�)/;
const leakedTranslationMarker = /(?:ZORBLAX\d+Z|987654321\d{10}123456789|https:\/\/(?:inrcy|l10n)\.invalid\/|ZXQINRCY|__IV\d|INRCY_TERM|(?:Italiano|Español|Deutsch|Nederlands|Português|English|Français):)/;
const frenchLeak = /\b(?:bilan|bo[iî]te|veuillez|réglages|échec|aperçu|cliquez|choisir|ouvrir|fermer|enregistrer|supprimer|annuler|devis|facture|aucun|aucune|vous|votre|vos)\b/iu;
const malformedPortuguesePossessive = /(?:à\s+)+(?:a\s+)+sua\b|(?:às\s+)+(?:as\s+)+suas\b|(?:ao\s+)+(?:o\s+)+seu\b|(?:aos\s+)+(?:os\s+)+seus\b|(?:^|[\s(])(?:a\s+a\s+sua|as\s+as\s+suas|o\s+o\s+seu|os\s+os\s+seus)\b/iu;
const protectedTerms = [
  ["iNrCy", /\binrcy\b/iu],
  ["iNr’Send", /\binr\s*['’]?\s*send\b/iu],
  ["iNr’Stats", /\binr\s*['’]?\s*stats\b/iu],
  ["iNr’Search", /\binr\s*['’]?\s*search\b/iu],
  ["iNr’Agent", /\binr\s*['’]?\s*agent\b/iu],
  ["iNr’Badge", /\binr\s*['’]?\s*badge\b/iu],
  ["Booster", /\bBooster\b/u],
  ["Google", /\bgoogle\b/iu],
  ["Facebook", /\bfacebook\b/iu],
  ["Instagram", /\binstagram\b/iu],
  ["LinkedIn", /\blinkedin\b/iu],
  ["TikTok", /\btiktok\b/iu],
  ["YouTube", /\byoutube\b/iu],
  ["Pinterest", /\bpinterest\b/iu],
  ["WhatsApp", /\bwhatsapp\b/iu],
  ["Stripe", /\bstripe\b/iu],
  ["GA4", /\bga4\b/iu],
  ["GSC", /\bgsc\b/iu],
  ["PDF", /\bpdf\b/iu],
];

function flatten(value, prefix = "", output = new Map()) {
  if (typeof value === "string") {
    output.set(prefix, value);
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Valeur non textuelle interdite dans ${prefix || "<racine>"}`);
  }
  for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, output);
  return output;
}

function variables(message) {
  const names = [];
  const walk = (elements) => {
    for (const element of elements) {
      if (element.type >= 1 && element.type <= 6 && typeof element.value === "string") {
        names.push(element.value);
      }
      if ((element.type === 5 || element.type === 6) && element.options) {
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if (element.type === 8 && element.children) walk(element.children);
    }
  };
  walk(parse(String(message)));
  return names.sort();
}

function placeholderSpacingErrors(source, translation) {
  const issues = [];
  const tokens = [...new Set(source.match(/\{value\d+\}/g) ?? [])];
  for (const token of tokens) {
    const sourceIndex = source.indexOf(token);
    const targetIndex = translation.indexOf(token);
    if (sourceIndex < 0 || targetIndex < 0) continue;
    const sourceHead = source.slice(0, sourceIndex);
    const targetHead = translation.slice(0, targetIndex);
    const expectedLeftBoundary = (sourceHead.match(/[.,;:!?…\s]+$/u)?.[0] ?? "").replace(/\s+/gu, " ");
    const actualLeftBoundary = (targetHead.match(/[.,;:!?…\s]+$/u)?.[0] ?? "").replace(/\s+/gu, " ");
    if (actualLeftBoundary !== expectedLeftBoundary) issues.push(`${token} ponctuation avant`);
    const sourceHasSpaceBefore = sourceIndex > 0 && /\s/u.test(source[sourceIndex - 1]);
    const sourceHasSpaceAfter = sourceIndex + token.length < source.length && /\s/u.test(source[sourceIndex + token.length]);
    if (sourceHasSpaceBefore && targetIndex > 0 && /[\p{L}\p{N}]/u.test(translation[targetIndex - 1])) issues.push(`${token} avant`);
    if (sourceHasSpaceAfter && targetIndex + token.length < translation.length && /[\p{L}\p{N}]/u.test(translation[targetIndex + token.length])) issues.push(`${token} après`);
    const sourceTail = source.slice(sourceIndex + token.length);
    const targetTail = translation.slice(targetIndex + token.length);
    const sourceBoundary = sourceTail.match(/^[.,;:!?…\s]+/u)?.[0];
    if (sourceBoundary === undefined) continue;
    const expectedBoundary = sourceBoundary.replace(/\s+/gu, " ");
    const actualBoundary = (targetTail.match(/^[.,;:!?…\s]+/u)?.[0] ?? "").replace(/\s+/gu, " ");
    if (actualBoundary !== expectedBoundary) issues.push(`${token} ponctuation`);
  }
  return issues;
}

function readCatalog(locale, namespace) {
  const file = path.join(root, "messages", locale, `${namespace}.json`);
  if (!fs.existsSync(file)) throw new Error(`Catalogue manquant: messages/${locale}/${namespace}.json`);
  return flatten(JSON.parse(fs.readFileSync(file, "utf8")));
}

function preview(value, maxLength = 180) {
  const text = String(value);
  return JSON.stringify(text.length > maxLength ? `${text.slice(0, maxLength)}…` : text);
}

const errors = [];
let messageCount = 0;
for (const namespace of namespaces) {
  let reference;
  try {
    reference = readCatalog("fr-FR", namespace);
  } catch (error) {
    errors.push(String(error));
    continue;
  }
  messageCount += reference.size;
  for (const locale of locales) {
    let catalog;
    try {
      catalog = readCatalog(locale, namespace);
    } catch (error) {
      errors.push(String(error));
      continue;
    }
    const missing = [...reference.keys()].filter((key) => !catalog.has(key));
    const extra = [...catalog.keys()].filter((key) => !reference.has(key));
    if (missing.length) errors.push(`${locale}/${namespace}: ${missing.length} clé(s) manquante(s): ${missing.slice(0, 5).join(", ")}`);
    if (extra.length) errors.push(`${locale}/${namespace}: ${extra.length} clé(s) en trop: ${extra.slice(0, 5).join(", ")}`);
    for (const [key, source] of reference) {
      const translation = catalog.get(key);
      const isIntentionalNbsp = key === "nbsp_47c1f11e" && translation === "\u00a0";
      if (typeof translation !== "string" || (!translation.trim() && !isIntentionalNbsp)) {
        errors.push(`${locale}/${namespace}/${key}: traduction vide`);
        continue;
      }
      if (renderedHtmlEntity.test(translation)) {
        errors.push(`${locale}/${namespace}/${key}: entité HTML non décodée`);
      }
      if (mojibake.test(translation)) errors.push(`${locale}/${namespace}/${key}: encodage corrompu`);
      if (leakedTranslationMarker.test(translation)) errors.push(`${locale}/${namespace}/${key}: marqueur de traduction interne présent`);
      if (locale !== "fr-FR" && frenchLeak.test(translation)) errors.push(`${locale}/${namespace}/${key}: fragment français non traduit`);
      if (locale === "pt-PT" && malformedPortuguesePossessive.test(translation)) {
        errors.push(`${locale}/${namespace}/${key}: article possessif portugais dupliqué`);
      }
      if (!source.includes("\n") && translation.includes("\n")) {
        errors.push(`${locale}/${namespace}/${key}: saut de ligne ajouté par la traduction`);
      }
      const lengthRatio = translation.length / Math.max(1, source.length);
      if (source.length > 40 && lengthRatio < 0.25) {
        errors.push(`${locale}/${namespace}/${key}: traduction anormalement courte`);
      }
      if (translation.length > 100 && lengthRatio > 3) {
        errors.push(`${locale}/${namespace}/${key}: traduction anormalement longue`);
      }
      for (const [term, pattern] of protectedTerms) {
        if (pattern.test(source) !== pattern.test(translation)) {
          errors.push(`${locale}/${namespace}/${key}: terme protégé ${term} ajouté ou supprimé; source=${preview(source)}; cible=${preview(translation)}`);
        }
      }
      const spacingIssues = placeholderSpacingErrors(source, translation);
      if (spacingIssues.length) {
        errors.push(`${locale}/${namespace}/${key}: espace manquant autour de ${spacingIssues.join(", ")}`);
      }
      let expectedVariables;
      let actualVariables;
      try {
        expectedVariables = variables(source).join("|");
        actualVariables = variables(translation).join("|");
      } catch (error) {
        errors.push(`${locale}/${namespace}/${key}: ICU invalide (${error.message})`);
        continue;
      }
      if (expectedVariables !== actualVariables) {
        errors.push(`${locale}/${namespace}/${key}: variables ${actualVariables || "∅"}, attendu ${expectedVariables || "∅"}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`Échec i18n: ${errors.length} anomalie(s).`);
  errors.slice(0, 100).forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`i18n valide: ${locales.length} langues, ${namespaces.length} catalogues, ${messageCount} messages de référence.`);
}
