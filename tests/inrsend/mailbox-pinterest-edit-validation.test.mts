import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const textRules = runtimeModules()<typeof import("../../app/dashboard/mails/_lib/pinterestPublicationEditText.ts")>("app/dashboard/mails/_lib/pinterestPublicationEditText.ts");
const form = { title: "T", content: "", cta: "", ctaMode: "none", ctaUrl: "", ctaPhone: "", ctaAction: "", hashtags: "" };

test("the native Pinterest editor counts the exact assembled description and Unicode characters", () => {
  for (const character of ["x", "😀"]) {
    const atLimit = textRules.getPinterestPublicationEditText({ ...form, content: character.repeat(797) }, []);
    assert.equal(atLimit.descriptionLength, 800);
    assert.deepEqual(atLimit.issues, []);
    const tooLong = textRules.getPinterestPublicationEditText({ ...form, content: character.repeat(798) }, []);
    assert.equal(tooLong.issues[0]?.field, "description");
    assert.equal(tooLong.issues[0]?.excess, 1);
  }
  assert.equal(textRules.getPinterestPublicationEditText({ ...form, title: "😀".repeat(100) }, []).titleLength, 100);
  assert.equal(textRules.getPinterestPublicationEditText({ ...form, title: "😀".repeat(101) }, []).issues[0]?.field, "title");
  const withTags = textRules.getPinterestPublicationEditText({ ...form, content: "Texte", hashtags: "#Paris;#Paris #Artisan" }, []);
  assert.ok(withTags.description.includes("#Paris"));
  assert.equal(withTags.description.match(/#Paris/g)?.length, 1);
  assert.equal(withTags.descriptionLength, [...withTags.description].length);
});

test("Pinterest editor counts image CTA fallback in the same retained-before-new order as the actual save request", () => {
  const image = (retained: boolean, text: string) => ({ retained, imageMeta: { interactions: { version: 1, items: [{ id: text, kind: "text", text, linkUrl: "https://artisan.fr/devis", x: 10, y: 10, width: 50, height: 15 }] } } });
  const images = textRules.orderPinterestPublicationEditImages([image(false, "Nouveau"), image(true, "Demander un devis")], item => item.retained);
  const result = textRules.getPinterestPublicationEditText({ ...form, content: "Présentation" }, images);
  assert.ok(result.description.includes("Demander un devis"), result.description);
  assert.ok(!result.description.includes("Nouveau"));
  const explicit = textRules.getPinterestPublicationEditText({ ...form, content: "Présentation", ctaMode: "custom", cta: "Découvrir", ctaUrl: "https://artisan.fr" }, images);
  assert.ok(explicit.description.includes("Découvrir"));
  assert.ok(!explicit.description.includes("Demander un devis"));
});

const clientSource = readFileSync(new URL("../../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("MailboxClient.tsx", clientSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callbackSource = "";
function findCallback(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "saveChannelPublication") callbackSource = node.getText(sourceFile);
  ts.forEachChild(node, findCallback);
}
findCallback(sourceFile);
assert.ok(callbackSource, "execute the actual native save callback");
const callback = ts.transpileModule(callbackSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const french = JSON.parse(readFileSync(new URL("../../messages/fr-FR/mails.json", import.meta.url), "utf8"));

function saveHarness() {
  const calls: string[] = [], errors: string[] = [];
  const context: Record<string, unknown> = {
    detailsItem: { source: "app_events" }, detailsPayload: { publication_id: "publication" }, activeDetailsChannelEntry: { key: "pinterest" }, activeAccountId: "account", activeDetailsChannelResult: {},
    normalizeChannelKey: (key: string) => key, channelApiPath: (key: string) => key,
    publicationEditBaselineRef: { current: { identity: "account:publication:pinterest", expectedState: Promise.resolve("a".repeat(64)), operationKey: "same-native-operation" } },
    publicationEditForm: { ...form }, publicationEditVideoByChannel: {}, publicationEditImagesByChannel: {},
    i18nT: (key: string, values: Record<string, unknown> = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), french[key] || key),
    setDetailsActionBusy: () => {}, setDetailsActionSuccess: () => {}, setDetailsActionError: (value: string) => { if (value) errors.push(value); }, setDetailsEditMode: () => {},
    ...textRules, getClientUserFacingErrorMessage: (error: Error) => error.message,
    formatChannelLabel: (key: string) => key,
    loadHistory: async () => { calls.push("history"); },
    fetch: async (url: string, options: { method?: string } = {}) => {
      calls.push(options.method || "GET");
      return { ok: true, json: async () => url === "/api/booster/cta-defaults" ? { siteWebUrl: "https://artisan.fr", phone: "+33123456789" } : { ok: true } };
    },
  };
  return { calls, errors, context, run: () => vm.runInNewContext(`${callback}\nsaveChannelPublication()`, context) as Promise<void> };
}

test("an invalid native Pinterest save never submits or consumes the operation, and a corrected save can use that same source version", async () => {
  const h = saveHarness();
  h.context.publicationEditForm = { ...form, content: "x".repeat(798) };
  await h.run();
  assert.deepEqual(h.calls, ["GET"], "only contact defaults are read; no PATCH, media upload or mutation");
  assert.match(h.errors.at(-1) || "", /description Pinterest.*1 caractères/);
  h.context.publicationEditForm = { ...form, content: "x".repeat(797) };
  await h.run();
  assert.deepEqual(h.calls, ["GET", "GET", "PATCH", "history"]);
  assert.equal(h.errors.length, 1);
});

test("all supported mailbox languages provide the counter, excess and actionable validation messages", () => {
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../messages/${locale}/mails.json`, import.meta.url), "utf8"));
    for (const field of ["title", "description"]) {
      assert.ok(catalog[`pinterest_publication_${field}_count`].includes("{count}"));
      assert.ok(catalog[`pinterest_publication_${field}_count`].includes("{max}"));
      assert.ok(catalog[`pinterest_publication_${field}_too_long`].includes("{count}"));
    }
    assert.ok(catalog.pinterest_publication_description_count_help);
    assert.ok(catalog.pinterest_publication_defaults_unavailable);
  }
});
