import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;

const recentFeatureKeys = [
  "confidentialite_0601_revision_20260907",
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
  "cga_0436_revision_20260907",
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
] as const;

test("the legal schema and all nine catalogues cover the recently added features", () => {
  const schema = read("app/legal/_components/legalDocumentSchema.ts");

  for (const key of recentFeatureKeys) assert.match(schema, new RegExp(`"${key}"`), key);

  for (const locale of locales) {
    const legal = JSON.parse(read(`messages/${locale}/legal.json`)) as Record<string, string>;
    const publicMessages = JSON.parse(read(`messages/${locale}/public.json`)) as Record<string, string>;
    const settings = JSON.parse(read(`messages/${locale}/settings.json`)) as Record<string, string>;

    for (const key of recentFeatureKeys) assert.ok(legal[key]?.trim(), `${locale}: ${key}`);
    assert.ok(publicMessages.derniere_mise_a_jour_07_09_2026_7a4f81d2, locale);
    assert.ok(publicMessages.version_du_07_09_2026_51f2b1b8, locale);
    assert.ok(publicMessages.version_juridique_synchronisee_le_07_09_2026_68a90e11, locale);
    assert.ok(settings.derniere_mise_a_jour_07_09_2026_7a4f81d2, locale);
    assert.ok(settings.version_du_07_09_2026_51f2b1b8, locale);
  }
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

test("public and in-app legal surfaces point to the 7 September 2026 revision", () => {
  const sources = [
    read("app/legal/_components/legalDocs.tsx"),
    read("app/legal/_components/LegalPageShell.tsx"),
    read("app/legal/confidentialite/page.tsx"),
    read("app/legal/cga/page.tsx"),
  ].join("\n");

  assert.match(sources, /derniere_mise_a_jour_07_09_2026_7a4f81d2/);
  assert.match(sources, /version_du_07_09_2026_51f2b1b8/);
  assert.match(sources, /version_juridique_synchronisee_le_07_09_2026_68a90e11/);
  assert.doesNotMatch(sources, /derniere_mise_a_jour_(?:08_08|30_06)|version_du_08_08|version_juridique_synchronisee_le_08_08/);
});
