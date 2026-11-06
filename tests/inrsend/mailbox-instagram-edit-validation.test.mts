import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const load = runtimeModules();
const instagram = load<typeof import("../../app/dashboard/mails/_lib/instagramPublicationEditText.ts")>("app/dashboard/mails/_lib/instagramPublicationEditText.ts");
const pinterest = load<typeof import("../../app/dashboard/mails/_lib/pinterestPublicationEditText.ts")>("app/dashboard/mails/_lib/pinterestPublicationEditText.ts");
const form = { title: "T", content: "", cta: "", ctaMode: "none", ctaUrl: "", ctaPhone: "", ctaAction: "", hashtags: "" };

test("the native Instagram editor counts the full unchanged caption at 2200 and rejects 2201 including Unicode", () => {
  for (const content of ["x".repeat(2197), `${"😀".repeat(1098)}x`]) {
    const atLimit = instagram.getInstagramPublicationEditText({ ...form, content }, []);
    assert.equal(atLimit.length, 2200); assert.equal(atLimit.issue, null);
    assert.equal(atLimit.caption, `T\n\n${content}`, "manual text is not shortened to the generation budget");
    const tooLong = instagram.getInstagramPublicationEditText({ ...form, content: `${content}x` }, []);
    assert.equal(tooLong.length, 2201); assert.equal(tooLong.issue?.excess, 1);
    assert.equal(tooLong.issue?.code, "instagram_caption_too_long");
    assert.equal(tooLong.caption, `T\n\n${content}x`, "invalid manual text remains available for correction");
  }
});

test("Instagram final counter includes native CTA text links and deduplicated hashtags rather than just the body", () => {
  const base = { ...form, content: "x", ctaMode: "website", cta: "Découvrir notre offre", ctaUrl: "https://artisan.fr/offre", hashtags: "#Paris;Paris #Artisan" };
  const first = instagram.getInstagramPublicationEditText(base, []);
  assert.ok(first.caption.includes("Découvrir notre offre")); assert.ok(first.caption.includes("https://artisan.fr/offre"));
  assert.equal(first.caption.match(/#Paris/g)?.length, 1);
  const content = "x".repeat(2200 - first.length + 1);
  const exact = instagram.getInstagramPublicationEditText({ ...base, content }, []);
  assert.equal(exact.length, 2200); assert.equal(exact.issue, null);
  assert.equal(instagram.getInstagramPublicationEditText({ ...base, content: `${content}x` }, []).issue?.excess, 1);
});

test("Instagram includes the selected image fallback CTA and keeps native retained-before-new image order", () => {
  const image = (retained: boolean, text: string) => ({ retained, imageMeta: { interactions: { version: 1, items: [{ id: text, kind: "text", text, linkUrl: "https://artisan.fr/devis", x: 10, y: 10, width: 50, height: 15 }] } } });
  const images = pinterest.orderPinterestPublicationEditImages([image(false, "Nouveau"), image(true, "Demander un devis")], item => item.retained);
  const result = instagram.getInstagramPublicationEditText({ ...form, content: "Présentation" }, images);
  assert.ok(result.caption.includes("Demander un devis")); assert.ok(result.caption.includes("https://artisan.fr/devis"));
  assert.ok(!result.caption.includes("Nouveau"));
  assert.equal(result.length, result.caption.length);
});

const source = readFileSync(new URL("../../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("MailboxClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callbackSource = "";
function find(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "saveChannelPublication") callbackSource = node.getText(ast); ts.forEachChild(node, find); }
find(ast); assert.ok(callbackSource);
const callback = ts.transpileModule(callbackSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const french = JSON.parse(readFileSync(new URL("../../messages/fr-FR/mails.json", import.meta.url), "utf8"));
function harness() {
  const calls: string[] = [], errors: string[] = [];
  const context: Record<string, unknown> = {
    detailsItem: { source: "app_events" }, detailsPayload: { publication_id: "publication" }, activeDetailsChannelEntry: { key: "instagram" }, activeAccountId: "account", activeDetailsChannelResult: {},
    normalizeChannelKey: (key: string) => key, channelApiPath: (key: string) => key,
    publicationEditBaselineRef: { current: { identity: "account:publication:instagram", expectedState: Promise.resolve("a".repeat(64)), operationKey: "same-native-operation" } },
    publicationEditForm: { ...form }, publicationEditVideoByChannel: {}, publicationEditImagesByChannel: {},
    i18nT: (key: string, values: Record<string, unknown> = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), french[key] || key),
    setDetailsActionBusy: () => {}, setDetailsActionSuccess: () => {}, setDetailsActionError: (value: string) => { if (value) errors.push(value); }, setDetailsEditMode: () => {},
    ...instagram, ...pinterest, getClientUserFacingErrorMessage: (error: Error) => error.message, formatChannelLabel: (key: string) => key,
    loadHistory: async () => { calls.push("history"); }, confirmInrcy: async () => { calls.push("confirm"); return true; },
    fetch: async (url: string, options: { method?: string } = {}) => { calls.push(options.method || "GET"); return { ok: true, json: async () => url === "/api/booster/cta-defaults" ? { siteWebUrl: "https://artisan.fr", phone: "+33123456789" } : { ok: true } }; },
  };
  return { calls, errors, context, run: () => vm.runInNewContext(`${callback}\nsaveChannelPublication()`, context) as Promise<void> };
}

test("native Instagram save rejects an excessive caption before uploads confirmation or PATCH and accepts its correction on the same source", async () => {
  const h = harness();
  h.context.publicationEditForm = { ...form, content: "x".repeat(2198) };
  await h.run(); assert.deepEqual(h.calls, ["GET"]); assert.match(h.errors.at(-1) || "", /légende Instagram.*1 caractères/);
  h.context.publicationEditForm = { ...form, content: "x".repeat(2197) };
  await h.run(); assert.deepEqual(h.calls, ["GET", "GET", "confirm", "PATCH", "history"]); assert.equal(h.errors.length, 1);
});

test("native Instagram publication confirmation remains required after validating its complete caption", async () => {
  const h = harness(); h.context.confirmInrcy = async () => { h.calls.push("confirm-declined"); return false; };
  await h.run(); assert.deepEqual(h.calls, ["GET", "confirm-declined"]); assert.deepEqual(h.errors, []);
});

test("all mailbox languages explain the complete Instagram caption count and actionable excess", () => {
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../messages/${locale}/mails.json`, import.meta.url), "utf8"));
    assert.ok(catalog.instagram_publication_caption_count.includes("{count}")); assert.ok(catalog.instagram_publication_caption_count.includes("{max}"));
    assert.ok(catalog.instagram_publication_caption_too_long.includes("{count}")); assert.ok(catalog.instagram_publication_caption_count_help);
  }
});
