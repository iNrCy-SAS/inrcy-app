import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const force = process.argv.includes("--force");
const onlyLocale = process.argv.find((argument) => argument.startsWith("--locale="))?.split("=")[1];
const onlyNamespace = process.argv.find((argument) => argument.startsWith("--namespace="))?.split("=")[1];
const delayArgument = process.argv.find((argument) => argument.startsWith("--delay="))?.split("=")[1];
const provider = process.argv.find((argument) => argument.startsWith("--provider="))?.split("=")[1] || "google";
const requestDelay = Math.max(1000, Number(delayArgument) || 2500);

const namespaces = fs.readdirSync(path.join(root, "messages", "fr-FR"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.basename(name, ".json"))
  .filter((namespace) => !["auth", "common", "dashboard"].includes(namespace))
  .sort();
const targetLanguages = {
  "en-GB": "en",
  "es-ES": "es",
  "it-IT": "it",
  "de-DE": "de",
  "nl-NL": "nl",
  "pt-PT": "pt",
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
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function protect(text, batchIndex, replacements) {
  let output = text;
  let variableIndex = 0;
  output = output.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder) => {
    const token = `https://l10n.invalid/variable/${batchIndex}/${variableIndex}`;
    variableIndex += 1;
    replacements.set(token, placeholder);
    return token;
  });

  let brandIndex = 0;
  output = output.replace(/iNr(?:['’])?[A-Za-z]+/g, (brand) => {
    const token = `https://l10n.invalid/brand/${batchIndex}/${brandIndex}`;
    brandIndex += 1;
    replacements.set(token, brand);
    return token;
  });

  protectedTerms.forEach((term, termIndex) => {
    const token = `https://l10n.invalid/term/${batchIndex}/${termIndex}`;
    if (!output.includes(term)) return;
    output = output.split(term).join(token);
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
  return [...String(text).matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

function assertPlaceholders(source, translation, key) {
  const expected = placeholders(source).join("|");
  const actual = placeholders(translation).join("|");
  if (expected !== actual) {
    throw new Error(`Variables altérées pour ${key}: ${expected} != ${actual}\nSOURCE=${source}\nTRADUCTION=${translation}`);
  }
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return (payload?.[0] ?? []).map((segment) => segment?.[0] ?? "").join("");
  } catch (error) {
    if (attempt >= 5) throw error;
    const retryDelay = String(error).includes("HTTP 429")
      ? Math.min(30_000, 4_000 * 2 ** (attempt - 1))
      : 750 * 2 ** (attempt - 1);
    await delay(retryDelay);
    return requestTranslation(text, targetLanguage, attempt + 1);
  }
}

async function translateBatch(batch, targetLanguage) {
  const replacements = new Map();
  const protectedMessages = batch.map(([, message], index) => protect(message, index, replacements));
  const separators = protectedMessages
    .slice(1)
    .map((_, index) => `https://l10n.invalid/split/${String(index + 1).padStart(4, "0")}`);
  let payload = protectedMessages[0] ?? "";
  for (let index = 1; index < protectedMessages.length; index += 1) {
    payload += `\n${separators[index - 1]}\n${protectedMessages[index]}`;
  }
  const translated = await requestTranslation(payload, targetLanguage);
  try {
    assertProtectedTokens(payload, translated, [...replacements.keys(), ...separators]);
  } catch (error) {
    if (batch.length === 1) {
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
  const ordered = Object.fromEntries(
    Object.keys(source)
      .filter((key) => typeof output[key] === "string")
      .map((key) => [key, output[key]]),
  );
  fs.writeFileSync(destination, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  return ordered;
}

async function translateCatalog(namespace, locale, targetLanguage) {
  const sourceFile = path.join(root, "messages", "fr-FR", `${namespace}.json`);
  const destination = path.join(root, "messages", locale, `${namespace}.json`);
  const source = readJson(sourceFile);
  const existing = force ? {} : readJson(destination);
  const pending = Object.entries(source).filter(([key]) => typeof existing[key] !== "string");
  // MyMemory rejects requests over 500 characters. Keep a little headroom for
  // URL-escaped separators and protected placeholders.
  const batches = makeBatches(pending, provider === "mymemory" ? 450 : 1700);
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
    writeOrderedCatalog(destination, source, output);
    console.log(`${locale}/${namespace}: lot ${index + 1}/${batches.length}`);
    await delay(requestDelay);
  }

  for (const key of Object.keys(output)) {
    if (!(key in source)) delete output[key];
  }
  const ordered = writeOrderedCatalog(destination, source, output);
  console.log(`${locale}/${namespace}: ${Object.keys(ordered).length} messages`);
}

for (const [locale, targetLanguage] of Object.entries(targetLanguages)) {
  if (onlyLocale && locale !== onlyLocale) continue;
  for (const namespace of namespaces) {
    if (onlyNamespace && namespace !== onlyNamespace) continue;
    await translateCatalog(namespace, locale, targetLanguage);
  }
}
