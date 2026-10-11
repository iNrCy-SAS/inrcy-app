import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;

const recentFeatureKeys = [
  "confidentialite_0601_revision_20261004",
  "confidentialite_0602_x",
  "confidentialite_0603_x_oauth",
  "confidentialite_0604_x_data",
  "confidentialite_0605_x_use",
  "confidentialite_0606_x_control",
  "confidentialite_0607_meta_formats",
  "confidentialite_0608_meta_transfer",
  "confidentialite_0609_meta_transform",
  "confidentialite_0610_studio",
  "confidentialite_0611_studio_inputs",
  "confidentialite_0612_studio_voice_qa",
  "confidentialite_0613_studio_review",
  "confidentialite_0614_dictation",
  "confidentialite_0615_dictation_flow",
  "confidentialite_0616_dictation_retention",
  "confidentialite_0617_dna_news",
  "confidentialite_0618_dna_sources",
  "confidentialite_0619_dna_reuse",
  "confidentialite_0620_cta_widget",
  "confidentialite_0621_whatsapp",
  "confidentialite_0622_widget",
  "confidentialite_0623_ads",
  "confidentialite_0624_ads_data",
  "confidentialite_0625_ads_sharing",
  "confidentialite_0626_ads_control",
  "cga_0436_revision_20261004",
  "cga_0437_x",
  "cga_0438_x_authorization",
  "cga_0439_x_duties",
  "cga_0440_meta_formats",
  "cga_0441_meta_media",
  "cga_0442_meta_limits",
  "cga_0443_studio",
  "cga_0444_studio_output",
  "cga_0445_studio_rights",
  "cga_0446_dictation",
  "cga_0447_dictation_review",
  "cga_0448_dna_news",
  "cga_0449_dna_scope",
  "cga_0450_dna_validation",
  "cga_0451_cta_widget",
  "cga_0452_whatsapp",
  "cga_0453_widget",
  "cga_0454_ads",
  "cga_0455_ads_scope",
  "cga_0456_ads_spend",
  "cga_0457_offer_changes",
  "cga_0458_offer_changes",
  "cga_0459_video_credits",
] as const;

function loadLegalModule<T>(relativePath: string, modules: Record<string, unknown>): T {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {} as T;
  new Function("exports", "require", output)(exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unmocked legal dependency: ${name}`);
    return modules[name];
  });
  return exports;
}

test("the legal schema and all nine catalogues cover the recently added features", () => {
  const schema = read("app/legal/_components/legalDocumentSchema.ts");

  for (const key of recentFeatureKeys) assert.match(schema, new RegExp(`"${key}"`), key);

  for (const locale of locales) {
    const legal = JSON.parse(read(`messages/${locale}/legal.json`)) as Record<string, string>;
    const publicMessages = JSON.parse(read(`messages/${locale}/public.json`)) as Record<string, string>;
    const settings = JSON.parse(read(`messages/${locale}/settings.json`)) as Record<string, string>;

    for (const key of recentFeatureKeys) assert.ok(legal[key]?.trim(), `${locale}: ${key}`);
    assert.ok(publicMessages.derniere_mise_a_jour_04_10_2026_7a4f81d2, locale);
    assert.ok(publicMessages.version_du_04_10_2026_51f2b1b8, locale);
    assert.ok(publicMessages.version_juridique_synchronisee_le_04_10_2026_68a90e11, locale);
    assert.ok(settings.derniere_mise_a_jour_04_10_2026_7a4f81d2, locale);
    assert.ok(settings.version_du_04_10_2026_51f2b1b8, locale);
    assert.ok(publicMessages.version_du_11_10_2026_video_credits, locale);
    assert.ok(settings.version_du_11_10_2026_video_credits, locale);
  }
});

test("Article 40 displays video and image credits in every language while preserving the existing credit conditions", () => {
  type Block = { kind: string; key?: string };
  const schema = loadLegalModule<{ LEGAL_DOCUMENT_BLOCKS: { cga: Block[] } }>("app/legal/_components/legalDocumentSchema.ts", {});
  const blocks = schema.LEGAL_DOCUMENT_BLOCKS.cga;
  const creditIndex = blocks.findIndex((block) => block.key === "cga_0459_video_credits");
  const article40 = blocks.findIndex((block) => block.key === "cga_0443_studio");
  const nextArticle = blocks.findIndex((block) => block.key === "cga_0446_dictation");
  assert.ok(article40 < creditIndex && creditIndex < nextArticle);
  assert.equal(blocks[creditIndex].kind, "paragraph");

  const kinds: Record<string, RegExp> = {
    "fr-FR": /crédits vidéo ou images/,
    "en-GB": /Video or image credit/,
    "es-ES": /créditos de vídeo o imágenes/,
    "it-IT": /crediti video o immagini/,
    "de-DE": /Video- oder Bild-Guthaben/,
    "nl-NL": /video- of afbeeldingentegoed/,
    "pt-PT": /créditos de vídeo ou imagens/,
    "th-TH": /เครดิตวิดีโอหรือภาพ/,
    "zh-CN": /视频或图片额度/,
  };
  for (const locale of locales) {
    const legal = JSON.parse(read(`messages/${locale}/legal.json`)) as Record<string, string>;
    const paragraph = legal.cga_0459_video_credits;
    assert.match(paragraph, kinds[locale], locale);
    const renderer = loadLegalModule<{ default: ComponentType<{ document: "cga" }> }>("app/legal/_components/LegalTextContent.tsx", {
      "react/jsx-runtime": jsxRuntime,
      "next-intl": { useTranslations: () => (key: string) => { assert.ok(legal[key], `${locale}: ${key}`); return legal[key]; } },
      "../legal.module.css": { __esModule: true, default: { h2: "h2", p: "p", ul: "ul", translationNotice: "translationNotice" } },
      "./legalDocumentSchema": schema,
    });
    const html = renderToStaticMarkup(createElement(renderer.default, { document: "cga" }));
    assert.ok(html.includes(renderToStaticMarkup(createElement("p", { className: "p" }, paragraph))), `${locale}: credits paragraph must appear through the real CGA renderer`);
  }

  const french = (JSON.parse(read("messages/fr-FR/legal.json")) as Record<string, string>).cga_0459_video_credits;
  for (const condition of [
    /achats ponctuels distincts de l’abonnement/,
    /après confirmation du paiement/,
    /prix sont indiqués HT/,
    /crédits inclus sont utilisés en premier/,
    /solde acheté non consommé est conservé au renouvellement mensuel/,
    /sous réserve des conditions d’accès au service/,
    /échec de génération libère les crédits réservés/,
    /remboursement accordé conformément aux présentes conditions et au droit applicable ajuste le solde correspondant/,
    /crédits déjà consommés peuvent créer un solde à régulariser sur les prochains achats, sans réduire le quota inclus/,
    /contestation de paiement peut suspendre les crédits concernés/,
    /rétablis lorsque le paiement est maintenu, ou annulés si les fonds sont retirés définitivement/,
  ]) assert.match(french, condition);
});

test("the X disclosure is limited to the exact implemented OAuth scopes", () => {
  const legal = JSON.parse(read("messages/fr-FR/legal.json")) as Record<string, string>;
  const xDisclosure = [
    legal.confidentialite_0603_x_oauth,
    legal.confidentialite_0604_x_data,
    legal.confidentialite_0605_x_use,
    legal.confidentialite_0606_x_control,
  ].join(" ");

  for (const scope of ["tweet.read", "users.read", "tweet.write", "media.write", "offline.access"]) {
    assert.match(xDisclosure, new RegExp(scope.replace(".", "\\.")));
  }
  assert.doesNotMatch(xDisclosure, /dm\.read|follows\.read|email\.read/i);
  assert.match(xDisclosure, /ne demande pas l’accès aux messages privés/);
});

test("the ADS disclosure names the planned platforms without promising approval", () => {
  const legal = JSON.parse(read("messages/fr-FR/legal.json")) as Record<string, string>;
  const ads = [legal.confidentialite_0624_ads_data, legal.cga_0455_ads_scope].join(" ");
  for (const platform of ["Google", "Pinterest", "ChatGPT", "Meta", "LinkedIn", "TikTok", "X"]) {
    assert.match(ads, new RegExp(`\\b${platform}\\b`));
  }
  assert.match(ads, /disponibilité technique/);
  assert.match(ads, /validation du compte/);
});

test("legal surfaces keep their existing revisions and CGA point to the video-credit revision", () => {
  const sources = [
    read("app/legal/_components/legalDocs.tsx"),
    read("app/legal/_components/LegalPageShell.tsx"),
    read("app/legal/confidentialite/page.tsx"),
    read("app/legal/cga/page.tsx"),
  ].join("\n");

  assert.match(sources, /derniere_mise_a_jour_04_10_2026_7a4f81d2/);
  assert.match(sources, /version_du_11_10_2026_video_credits/);
  assert.match(sources, /version_juridique_synchronisee_le_04_10_2026_68a90e11/);
  assert.doesNotMatch(sources, /derniere_mise_a_jour_(?:08_08|30_06)|version_du_08_08|version_juridique_synchronisee_le_08_08/);
});

test("public iNrCy contact details use the confirmed phone number", () => {
  const contact = read("app/dashboard/settings/_components/ContactContent.tsx");
  const publicDirectory = read("lib/inrSearchPublic.ts");

  assert.match(contact, /PHONE_DISPLAY = "06\.31\.26\.08\.12"/);
  assert.match(contact, /PHONE_TEL = "\+33631260812"/);
  assert.match(contact, /WHATSAPP_PHONE = "33631260812"/);
  assert.match(publicDirectory, /phone: "06 31 26 08 12"/);

  for (const locale of locales) {
    const legal = JSON.parse(read(`messages/${locale}/legal.json`)) as Record<string, string>;
    assert.match(legal.mentions_legales_0029_665e243b, /06 31 26 08 12/, locale);
  }
});
