import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;

test("les trois documents légaux utilisent un catalogue complet dans les neuf langues", () => {
  const reference = JSON.parse(read("messages/fr-FR/legal.json")) as Record<string, string>;
  const referenceKeys = Object.keys(reference).sort();
  const schema = read("app/legal/_components/legalDocumentSchema.ts");
  const renderer = read("app/legal/_components/LegalTextContent.tsx");

  assert.ok(referenceKeys.length > 1_000);
  assert.match(schema, /"mentions-legales"/);
  assert.match(schema, /"confidentialite"/);
  assert.match(schema, /"cga"/);
  assert.match(renderer, /useTranslations\("legal"\)/);
  assert.match(renderer, /version_francaise_reference_2d7d7eab/);

  for (const locale of locales) {
    const catalog = JSON.parse(read(`messages/${locale}/legal.json`)) as Record<string, string>;
    assert.deepEqual(Object.keys(catalog).sort(), referenceKeys, locale);
    assert.ok(Object.values(catalog).every((message) => typeof message === "string" && message.trim()), locale);
  }

  const english = JSON.parse(read("messages/en-GB/legal.json")) as Record<string, string>;
  assert.match(english.mentions_legales_0001_8259f691, /Site|Website|software/i);
  assert.doesNotMatch(english.mentions_legales_0001_8259f691, /Éditeur/);
  assert.match(english.version_francaise_reference_2d7d7eab, /French version/i);
});

test("les dates légales de la modale Réglages existent dans chaque langue", () => {
  for (const locale of locales) {
    const settings = JSON.parse(read(`messages/${locale}/settings.json`)) as Record<string, string>;
    assert.ok(settings.derniere_mise_a_jour_04_10_2026_7a4f81d2, locale);
    assert.ok(settings.version_du_04_10_2026_51f2b1b8, locale);
  }

  const modal = read("app/dashboard/settings/_components/LegalDocumentsModal.tsx");
  assert.doesNotMatch(modal, /derniere_mise_a_jour_30_06_0c4ba073/);
});

test("le cockpit reste complet et lisible sur desktop comme en responsive", () => {
  const hero = read("app/dashboard/_components/DashboardHero.tsx");
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(hero, /const setupSteps = \[/);
  assert.match(hero, /className=\{`\$\{styles\.heroLeft\} \$\{styles\.cockpitPanel\}`\}/);
  assert.match(hero, /className=\{styles\.cockpitSummaryHeader\}/);
  assert.match(hero, /className=\{styles\.cockpitStages\}/);
  assert.match(hero, /className=\{styles\.cockpitStageBar\}/);
  assert.match(hero, /channelPowerSteps\.map/);
  assert.doesNotMatch(hero, /cockpitOpen|cockpitToggle/);
  assert.match(css, /@media \(min-width: 1081px\)[\s\S]*?\.hero\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.heroLeft\.cockpitPanel/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.cockpitSummaryHeader/);
  assert.match(hero, /styles\.cockpitTitleDesktop[^\n]*heroT\("cockpitTitle"\)/);
  assert.match(hero, /styles\.cockpitTitleMobile[^\n]*heroT\("cockpitShortTitle"\)/);
  assert.match(css, /\.cockpitTitleMobile\s*\{\s*display: none/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.cockpitTitleDesktop\s*\{\s*display: none[\s\S]*?\.cockpitTitleMobile\s*\{\s*display: inline/);

  for (const locale of locales) {
    const dashboard = JSON.parse(read(`messages/${locale}/dashboard.json`)) as {
      hero: Record<string, string>;
    };
    assert.ok(dashboard.hero.cockpitShortTitle?.trim(), locale);
  }
  const french = JSON.parse(read("messages/fr-FR/dashboard.json")) as {
    hero: Record<string, string>;
  };
  assert.equal(french.hero.cockpitTitle, "Votre cockpit");
  assert.equal(french.hero.cockpitShortTitle, "Cockpit");
});

test("le Générateur central conserve ses commandes et son état accessible sans texte visible redondant", () => {
  const generator = read("app/dashboard/_components/DashboardGeneratorHub.tsx");
  const orb = read("app/dashboard/_components/DashboardGeneratorOrb.tsx");
  const css = read("app/dashboard/_components/DashboardExperience.module.css");

  assert.match(generator, /aria-label=\{`\$\{heroT\("generatorShortTitle"\)\} · \$\{generatorIsActive \? t\.hero\.active : t\.hero\.waiting\}`\}/);
  assert.match(generator, /<DashboardGeneratorOrb isActive=\{generatorIsActive\}/);
  assert.match(orb, /data-active=\{isActive === null \? "unknown" : String\(isActive\)\} aria-hidden="true"/);
  assert.match(orb, /<span className=\{styles\.status\} \/>/);
  assert.doesNotMatch(generator, /<strong>|>\s*\{heroT\("generatorShortTitle"\)/);
  for (const action of ["onOpenGeneratorHelp", "onRefreshGenerator"]) {
    assert.ok(generator.includes(`onClick={${action}}`), action);
  }
  assert.match(generator, /disabled=\{kpisLoading\} aria-busy=\{kpisLoading \|\| undefined\}/);
  assert.match(generator, /generatorIsActive \? t\.hero\.active : t\.hero\.waiting/);
  const hero = read("app/dashboard/_components/DashboardHero.tsx");
  assert.match(hero, /uiBalance\.toLocaleString\(locale\)/);
  assert.match(css, /\.hubRow\s*\{[^}]*grid-area: generator/);
  assert.doesNotMatch(css, /\.channelsHub:(?:hover|active|focus-visible)/);
  assert.doesNotMatch(generator, /onOpenGeneratorSettings|settingsAria|settingsTitle/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const locale of locales) {
    const dashboard = JSON.parse(read(`messages/${locale}/dashboard.json`)) as { hero: Record<string, string> };
    for (const key of ["settingsAria", "settingsTitle", "active", "waiting"]) {
      assert.ok(dashboard.hero[key]?.trim(), `${locale}/${key}`);
    }
  }
});
