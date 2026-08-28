import fs from "node:fs";
import path from "node:path";
import { parse } from "@formatjs/icu-messageformat-parser";

const root = process.cwd();
const force = process.argv.includes("--force");
const repairIcu = process.argv.includes("--repair-icu");
const repairProtected = process.argv.includes("--repair-protected");
const onlyLocale = process.argv.find((argument) => argument.startsWith("--locale="))?.split("=")[1];
const onlyNamespace = process.argv.find((argument) => argument.startsWith("--namespace="))?.split("=")[1];
const delayArgument = process.argv.find((argument) => argument.startsWith("--delay="))?.split("=")[1];
const provider = process.argv.find((argument) => argument.startsWith("--provider="))?.split("=")[1] || "google";
const requestDelay = Math.max(1000, Number(delayArgument) || 2500);

const namespaces = fs.readdirSync(path.join(root, "messages", "fr-FR"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.basename(name, ".json"))
  .sort();
const targetLanguages = {
  "en-GB": "en",
  "es-ES": "es",
  "it-IT": "it",
  "de-DE": "de",
  "nl-NL": "nl",
  "pt-PT": "pt",
  "th-TH": "th",
  "zh-CN": "zh-CN",
};

const protectedTerms = [
  "iNrCy",
  "iNrStats",
  "iNrSend",
  "iNr'Agent",
  "iNr’Agent",
  "iNr'Badge",
  "iNr’Badge",
  "iNr'Annuaire",
  "iNr’Annuaire",
  "iNr'Search",
  "iNr’Search",
  "iNr'Booster",
  "iNr’Booster",
  "Google Business",
  "Google",
  "LinkedIn",
  "Instagram",
  "Facebook",
  "TikTok",
  "Pinterest",
  "YouTube",
  "WhatsApp",
  "Booster",
  "Stripe",
  "GA4",
  "GSC",
  "PDF",
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'],
    ["apos", "'"], ["#39", "'"], ["nbsp", "\u00a0"],
  ]);
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/giu, (entity, code) => {
    const normalized = String(code).toLowerCase();
    if (normalized.startsWith("#x")) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith("#")) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    return named.get(normalized) ?? entity;
  });
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function protectedToken(kind, batchIndex, itemIndex) {
  if (provider === "google-mobile") {
    return `ZXQ${kind.toUpperCase()}${String(batchIndex).padStart(4, "0")}${String(itemIndex).padStart(4, "0")}QXZ`;
  }
  return `https://l10n.invalid/${kind}/${batchIndex}/${itemIndex}`;
}

const PATH_SEPARATOR = "\u001f";

function flattenCatalog(value, prefix = [], output = {}) {
  if (typeof value === "string") {
    output[prefix.join(PATH_SEPARATOR)] = value;
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    flattenCatalog(child, [...prefix, key], output);
  }
  return output;
}

function buildOrderedCatalog(source, output, prefix = []) {
  if (typeof source === "string") return output[prefix.join(PATH_SEPARATOR)];
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const ordered = {};
  for (const [key, child] of Object.entries(source)) {
    const value = buildOrderedCatalog(child, output, [...prefix, key]);
    if (value !== undefined) ordered[key] = value;
  }
  return ordered;
}

function protect(text, batchIndex, replacements) {
  let output = text;
  let variableIndex = 0;
  output = output.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder) => {
    const token = protectedToken("variable", batchIndex, variableIndex);
    variableIndex += 1;
    replacements.set(token, placeholder);
    return token;
  });

  let tagIndex = 0;
  output = output.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => {
    const token = protectedToken("tag", batchIndex, tagIndex);
    tagIndex += 1;
    replacements.set(token, tag);
    return token;
  });

  let brandIndex = 0;
  output = output.replace(/iNr(?:['’])?[A-Za-z]+/g, (brand) => {
    const token = protectedToken("brand", batchIndex, brandIndex);
    brandIndex += 1;
    replacements.set(token, brand);
    return token;
  });

  protectedTerms.forEach((term, termIndex) => {
    const token = protectedToken("term", batchIndex, termIndex);
    if (!output.toLocaleLowerCase().includes(term.toLocaleLowerCase())) return;
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escapedTerm, "giu"), token);
    replacements.set(token, term);
  });
  return output;
}

function restore(text, replacements) {
  let output = text;
  for (const [token, term] of replacements) output = output.split(token).join(term);
  return output;
}

function placeholders(text) {
  const names = [];
  const visit = (elements) => {
    for (const element of elements) {
      if (element.type >= 1 && element.type <= 6 && typeof element.value === "string") {
        names.push(element.value);
      }
      if (element.options) {
        for (const option of Object.values(element.options)) visit(option.value);
      }
      if (element.children) visit(element.children);
    }
  };
  visit(parse(String(text)));
  return names.sort();
}

function assertPlaceholders(source, translation, key) {
  const expected = placeholders(source).join("|");
  const actual = placeholders(translation).join("|");
  if (expected !== actual) {
    throw new Error(`Variables altérées pour ${key}: ${expected} != ${actual}\nSOURCE=${source}\nTRADUCTION=${translation}`);
  }
}

function collectIcuLiteralRanges(elements, ranges = []) {
  for (const element of elements) {
    if (element.type === 0 && element.location) {
      ranges.push([element.location.start.offset, element.location.end.offset]);
    }
    if (element.options) {
      for (const option of Object.values(element.options)) {
        collectIcuLiteralRanges(option.value, ranges);
      }
    }
    if (element.children) collectIcuLiteralRanges(element.children, ranges);
  }
  return ranges;
}

function hasComplexIcu(message) {
  let found = false;
  const visit = (elements) => {
    for (const element of elements) {
      if (element.type === 5 || element.type === 6) found = true;
      if (element.options) {
        for (const option of Object.values(element.options)) visit(option.value);
      }
      if (element.children) visit(element.children);
    }
  };
  visit(parse(String(message)));
  return found;
}

function icuStructure(message) {
  const signature = [];
  const visit = (elements) => {
    for (const element of elements) {
      if (element.type >= 1 && element.type <= 6) {
        signature.push(`${element.type}:${element.value}`);
      } else if (element.type === 7) {
        signature.push("7:#");
      } else if (element.type === 8) {
        signature.push(`8:${element.value}`);
      }
      if (element.options) {
        signature.push(`options:${Object.keys(element.options).join("|")}`);
        for (const option of Object.values(element.options)) visit(option.value);
      }
      if (element.children) visit(element.children);
    }
  };
  visit(parse(String(message)));
  return signature.join(";");
}

function needsIcuRepair(source, translation) {
  if (!hasComplexIcu(source)) return false;
  if (typeof translation !== "string") return true;
  try {
    return icuStructure(source) !== icuStructure(translation);
  } catch {
    return true;
  }
}

function needsProtectedTermRepair(source, translation) {
  if (typeof translation !== "string") return true;
  const normalizedSource = source.toLocaleLowerCase();
  const normalizedTranslation = translation.toLocaleLowerCase();
  return protectedTerms.some((term) => {
    const normalizedTerm = term.toLocaleLowerCase();
    return normalizedSource.includes(normalizedTerm) !== normalizedTranslation.includes(normalizedTerm);
  });
}

function countOccurrences(text, token) {
  return String(text).split(token).length - 1;
}

function assertProtectedTokens(source, translation, tokens) {
  for (const token of tokens) {
    const expected = countOccurrences(source, token);
    const actual = countOccurrences(translation, token);
    if (expected !== actual) {
      throw new Error(`Protected token altered: ${token} (${expected} != ${actual})`);
    }
  }
}

function repairMobileBrandTokens(source, translation, tokens) {
  let output = translation;
  for (const token of tokens) {
    const repairable = /(?:ZXQ(?:BRAND|TERM)|\/(?:brand|term)\/)/u.test(token);
    if (!repairable) continue;
    const expected = countOccurrences(source, token);
    let seen = 0;
    if (countOccurrences(output, token) > expected) {
      output = output.split(token).map((part, index) => {
        if (index === 0) return part;
        seen += 1;
        return `${seen <= expected ? token : ""}${part}`;
      }).join("");
    }
    const missing = expected - countOccurrences(output, token);
    if (missing > 0) output += ` ${Array.from({ length: missing }, () => token).join(" ")}`;
  }
  return output;
}

function isVariableToken(token) {
  return /(?:ZXQVARIABLE|\/variable\/)/u.test(token);
}

async function retryMobileWithBracketedVariables(payload, translated, replacements, targetLanguage, batch) {
  const variableTokens = [...replacements.keys()].filter(isVariableToken);
  const hasAlteredVariable = variableTokens.some(
    (token) => countOccurrences(payload, token) !== countOccurrences(translated, token),
  );
  if (!hasAlteredVariable) return null;

  let fallbackPayload = payload;
  for (const token of variableTokens) {
    fallbackPayload = fallbackPayload.split(token).join(`[[${token}]]`);
  }

  let fallbackTranslated = await requestTranslation(fallbackPayload, targetLanguage);
  for (const token of variableTokens) {
    fallbackTranslated = fallbackTranslated.split(`[[${token}]]`).join(token);
    fallbackPayload = fallbackPayload.split(`[[${token}]]`).join(token);
  }
  const protectedTokens = [...replacements.keys()];
  const repaired = repairMobileBrandTokens(fallbackPayload, fallbackTranslated, protectedTokens);
  assertProtectedTokens(fallbackPayload, repaired, protectedTokens);
  const restored = restore(repaired.trim(), replacements);
  assertPlaceholders(batch[0][1], restored, batch[0][0]);
  return restored;
}

function makeBatches(entries, maxCharacters = 1700) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    const addition = entry[1].length + 40;
    if (current.length && size + addition > maxCharacters) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += addition;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function requestTranslation(text, targetLanguage, attempt = 1) {
  if (provider === "google-mobile") {
    try {
      const query = new URLSearchParams({ sl: "fr", tl: targetLanguage, q: text, hl: "fr" });
      const response = await fetch(`https://translate.google.com/m?${query}`, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const match = html.match(/<div class="result-container">([\s\S]*?)<\/div>/i);
      if (!match) throw new Error("Réponse mobile illisible");
      return decodeHtmlEntities(match[1]);
    } catch (error) {
      if (attempt >= 10) throw error;
      const retryDelay = String(error).includes("HTTP 429")
        ? Math.min(120_000, 10_000 * 2 ** (attempt - 1))
        : Math.min(20_000, 1_000 * 2 ** (attempt - 1));
      console.warn(`Traduction mobile temporairement indisponible (${error.message}), reprise dans ${Math.ceil(retryDelay / 1_000)} s.`);
      await delay(retryDelay);
      return requestTranslation(text, targetLanguage, attempt + 1);
    }
  }

  if (provider === "mymemory") {
    try {
      const response = await fetch(`https://api.mymemory.translated.net/get?${new URLSearchParams({
        q: text,
        langpair: `fr|${targetLanguage}`,
      })}`, {
        headers: { "user-agent": "iNrCy-i18n-catalog-builder/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (String(payload?.responseStatus) !== "200") {
        throw new Error(payload?.responseDetails || `MyMemory status ${payload?.responseStatus}`);
      }
      return String(payload?.responseData?.translatedText || "");
    } catch (error) {
      if (attempt >= 4) throw error;
      await delay(Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
      return requestTranslation(text, targetLanguage, attempt + 1);
    }
  }

  const body = new URLSearchParams({
    client: "gtx",
    sl: "fr",
    tl: targetLanguage,
    dt: "t",
    q: text,
  });
  try {
    const response = await fetch("https://translate.googleapis.com/translate_a/single", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "iNrCy-i18n-catalog-builder/1.0",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = Number(response.headers.get("retry-after")) || 0;
      throw error;
    }
    const payload = await response.json();
    return (payload?.[0] ?? []).map((segment) => segment?.[0] ?? "").join("");
  } catch (error) {
    if (attempt >= 12) throw error;
    const retryDelay = error?.status === 429 || String(error).includes("HTTP 429")
      ? Math.max(error?.retryAfter * 1_000 || 0, Math.min(180_000, 15_000 * 2 ** (attempt - 1)))
      : 750 * 2 ** (attempt - 1);
    console.warn(`Traduction temporairement indisponible (${error.message}), reprise dans ${Math.ceil(retryDelay / 1_000)} s.`);
    await delay(retryDelay);
    return requestTranslation(text, targetLanguage, attempt + 1);
  }
}

async function translateIcuLiteral(literal, targetLanguage, literalIndex) {
  const leading = literal.match(/^\s*/u)?.[0] ?? "";
  const trailing = literal.match(/\s*$/u)?.[0] ?? "";
  const coreEnd = Math.max(leading.length, literal.length - trailing.length);
  const core = literal.slice(leading.length, coreEnd);
  if (!core || !/[\p{L}\p{N}]/u.test(core)) return literal;

  const replacements = new Map();
  let payload = protect(core, literalIndex, replacements);
  for (const token of replacements.keys()) payload = payload.split(token).join(`[[${token}]]`);

  let translated = await requestTranslation(payload, targetLanguage);
  for (const token of replacements.keys()) {
    translated = translated.split(`[[${token}]]`).join(token);
    payload = payload.split(`[[${token}]]`).join(token);
  }
  assertProtectedTokens(payload, translated, [...replacements.keys()]);
  await delay(Math.min(requestDelay, 1_000));
  return `${leading}${restore(translated.trim(), replacements)}${trailing}`;
}

async function translateComplexIcuMessage(message, targetLanguage) {
  const elements = parse(String(message), { captureLocation: true });
  const ranges = collectIcuLiteralRanges(elements).sort((left, right) => left[0] - right[0]);
  let output = "";
  let cursor = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const [start, end] = ranges[index];
    output += message.slice(cursor, start);
    output += await translateIcuLiteral(message.slice(start, end), targetLanguage, index);
    cursor = end;
  }
  output += message.slice(cursor);
  parse(output);
  return output;
}

async function translateBatch(batch, targetLanguage) {
  if (batch.some(([, message]) => hasComplexIcu(message))) {
    const translations = [];
    for (const [key, message] of batch) {
      if (hasComplexIcu(message)) {
        translations.push(await translateComplexIcuMessage(message, targetLanguage));
      } else {
        translations.push((await translateBatch([[key, message]], targetLanguage))[0]);
      }
    }
    return translations;
  }

  const replacements = new Map();
  const protectedMessages = batch.map(([, message], index) => protect(message, index, replacements));
  const separators = protectedMessages
    .slice(1)
    .map((_, index) => protectedToken("split", 0, index + 1));
  let payload = protectedMessages[0] ?? "";
  for (let index = 1; index < protectedMessages.length; index += 1) {
    payload += `\n${separators[index - 1]}\n${protectedMessages[index]}`;
  }
  const bracketedTokens = provider === "google-mobile"
    ? [...replacements.keys(), ...separators]
    : [];
  for (const token of bracketedTokens) payload = payload.split(token).join(`[[${token}]]`);
  let translated = await requestTranslation(payload, targetLanguage);
  for (const token of bracketedTokens) {
    translated = translated.split(`[[${token}]]`).join(token);
    payload = payload.split(`[[${token}]]`).join(token);
  }
  try {
    assertProtectedTokens(payload, translated, [...replacements.keys(), ...separators]);
  } catch (error) {
    if (batch.length === 1) {
      if (provider === "google-mobile") {
        const repaired = repairMobileBrandTokens(payload, translated, [...replacements.keys()]);
        try {
          assertProtectedTokens(payload, repaired, [...replacements.keys()]);
          return [restore(repaired.trim(), replacements)];
        } catch (repairError) {
          const variableFallback = await retryMobileWithBracketedVariables(
            payload,
            repaired,
            replacements,
            targetLanguage,
            batch,
          );
          if (variableFallback !== null) return [variableFallback];
          throw new Error(
            `Protected translation unreadable for ${batch[0][0]}: ${repairError.message}`,
          );
        }
      }
      throw new Error(`Protected translation unreadable for ${batch[0][0]}: ${error.message}`);
    }
    const middle = Math.ceil(batch.length / 2);
    return [
      ...(await translateBatch(batch.slice(0, middle), targetLanguage)),
      ...(await translateBatch(batch.slice(middle), targetLanguage)),
    ];
  }
  let parts = [translated];
  if (separators.length) {
    const pattern = new RegExp(`\\s*(?:${separators.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*`, "g");
    parts = translated.split(pattern);
  }
  if (parts.length !== batch.length) {
    if (batch.length === 1) throw new Error(`Réponse de traduction illisible pour ${batch[0][0]}`);
    const middle = Math.ceil(batch.length / 2);
    return [
      ...(await translateBatch(batch.slice(0, middle), targetLanguage)),
      ...(await translateBatch(batch.slice(middle), targetLanguage)),
    ];
  }
  return parts.map((part) => restore(part.trim(), replacements));
}

function writeOrderedCatalog(destination, source, output) {
  const ordered = buildOrderedCatalog(source, output) || {};
  fs.writeFileSync(destination, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  return ordered;
}

async function translateCatalog(namespace, locale, targetLanguage) {
  const sourceFile = path.join(root, "messages", "fr-FR", `${namespace}.json`);
  const destination = path.join(root, "messages", locale, `${namespace}.json`);
  const sourceCatalog = readJson(sourceFile);
  const source = flattenCatalog(sourceCatalog);
  const existing = force ? {} : flattenCatalog(readJson(destination));
  if ((repairIcu || repairProtected) && Object.keys(existing).length !== Object.keys(source).length) {
    throw new Error(`${locale}/${namespace}: catalogue incomplet, terminez la traduction avant la réparation`);
  }
  const pending = Object.entries(source).filter(([key, message]) => (
    repairIcu
      ? needsIcuRepair(message, existing[key])
      : repairProtected
        ? needsProtectedTermRepair(message, existing[key])
        : typeof existing[key] !== "string"
  ));
  // MyMemory rejects requests over 500 characters. Keep a little headroom for
  // URL-escaped separators and protected placeholders.
  const batches = makeBatches(pending, provider === "mymemory" ? 450 : provider === "google-mobile" ? 1500 : 1700);
  const output = { ...existing };

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const translated = await translateBatch(batch, targetLanguage);
    batch.forEach(([key, sourceMessage], itemIndex) => {
      const value = translated[itemIndex];
      assertPlaceholders(sourceMessage, value, `${locale}/${namespace}/${key}`);
      output[key] = value;
    });
    // Checkpoint every successful batch so a provider rate limit never loses
    // translations that have already passed placeholder validation.
    writeOrderedCatalog(destination, sourceCatalog, output);
    console.log(`${locale}/${namespace}: lot ${index + 1}/${batches.length}`);
    await delay(requestDelay);
  }

  for (const key of Object.keys(output)) {
    if (!(key in source)) delete output[key];
  }
  const ordered = writeOrderedCatalog(destination, sourceCatalog, output);
  console.log(`${locale}/${namespace}: ${Object.keys(flattenCatalog(ordered)).length} messages`);
}

for (const [locale, targetLanguage] of Object.entries(targetLanguages)) {
  if (onlyLocale && locale !== onlyLocale) continue;
  for (const namespace of namespaces) {
    if (onlyNamespace && namespace !== onlyNamespace) continue;
    await translateCatalog(namespace, locale, targetLanguage);
  }
}
