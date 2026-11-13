import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load<T>(file: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} as T };
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  });
  return loaded.exports;
}

const language = load("lib/appLanguage.ts");
const copyModule = load<{ AI_MEDIA_PUBLIC_ERROR_COPY: Record<string, Record<string, string>> }>("lib/aiMediaGenerationPublicErrorCopy.ts");
const errors = load("lib/userFacingErrors.ts", {
  "./appLanguage": language, "@/lib/appLanguage": language,
  "@/lib/publicationErrorFrench": load("lib/publicationErrorFrench.ts"),
  "@/lib/metaGraphErrorClassification": load("lib/metaGraphErrorClassification.ts"),
});
const helpers = load<typeof import("../../lib/aiMediaGenerationPublicErrorI18n.ts")>("lib/aiMediaGenerationPublicErrorI18n.ts", {
  "./appLanguage": language, "./userFacingErrors": errors, "./aiMediaGenerationPublicErrorCopy": copyModule,
});
const { AI_MEDIA_PUBLIC_ERROR_CATALOG } = load<typeof import("../../lib/aiMediaGenerationPublicErrors.ts")>("lib/aiMediaGenerationPublicErrors.ts");
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const codes = Object.keys(AI_MEDIA_PUBLIC_ERROR_CATALOG).sort();

test("every public media failure has reviewed client copy in all nine languages", () => {
  for (const locale of locales) {
    const copy = copyModule.AI_MEDIA_PUBLIC_ERROR_COPY[locale.slice(0, 2)];
    assert.deepEqual(Object.keys(copy).sort(), codes, `${locale}: a public code is missing or obsolete`);
    for (const code of codes) {
      assert.ok(copy[code].trim());
      assert.doesNotMatch(copy[code], /AI_MEDIA_[A-Z_]+|SQLSTATE|Traceback|sk_live_\w+|Bearer\s+\w+/);
      const result = helpers.getLocalizedAiMediaGenerationErrorMessage({
        error_code: code, message: "Traceback: private_provider_state sk_live_hidden", reason: "untrusted free text",
      }, locale, "Safe fallback");
      assert.equal(result, copy[code], `${locale}: ${code} must keep its specific advice`);
    }
  }
});

test("unknown diagnostics and codes hidden in user content never reach the client", () => {
  const circular: Record<string, unknown> = { message: "opaque_provider_state sk_live_hidden", prompt: "AI_MEDIA_QUOTA_REACHED" };
  circular.error = circular;
  for (const locale of locales) {
    const result = helpers.getLocalizedAiMediaGenerationErrorMessage(circular, locale, "Safe fallback");
    assert.equal(result, "Safe fallback");
    assert.doesNotMatch(result, /opaque|sk_live|AI_MEDIA/);
  }
});

test("client media failures follow the saved application locale and tolerate blocked storage", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const code = "AI_MEDIA_VIDEO_SPEECH_VERIFICATION_UNAVAILABLE";
  try {
    for (const locale of locales) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => locale } } });
      Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "fr-FR" } } });
      assert.equal(helpers.getClientAiMediaGenerationErrorMessage({ code }), copyModule.AI_MEDIA_PUBLIC_ERROR_COPY[locale.slice(0, 2)][code]);
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem() { throw new Error("Storage blocked"); } } } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "de-DE" } } });
    assert.equal(helpers.getClientAiMediaGenerationErrorMessage({ code }), copyModule.AI_MEDIA_PUBLIC_ERROR_COPY.de[code]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
