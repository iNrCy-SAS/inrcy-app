import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT"] as const;

test("les trois documents légaux utilisent un catalogue complet dans les sept langues", () => {
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
    assert.ok(settings.derniere_mise_a_jour_08_08_f576f6f7, locale);
    assert.ok(settings.version_du_08_08_2026_1465b7bb, locale);
  }

  const modal = read("app/dashboard/settings/_components/LegalDocumentsModal.tsx");
  assert.doesNotMatch(modal, /derniere_mise_a_jour_30_06_0c4ba073/);
});

test("le cockpit reste complet sur desktop et se replie uniquement en responsive", () => {
  const hero = read("app/dashboard/_components/DashboardHero.tsx");
  const css = read("app/dashboard/dashboard.module.css");
  const responsiveCockpit = css.slice(css.indexOf("Cockpit compact — responsive uniquement"));

  assert.match(hero, /const \[cockpitOpen, setCockpitOpen\] = useState\(false\)/);
  assert.match(hero, /aria-expanded=\{cockpitOpen\}/);
  assert.match(hero, /aria-controls="dashboard-cockpit-details"/);
  assert.doesNotMatch(hero, /inert=\{!cockpitOpen\}/);
  assert.match(hero, /className=\{styles\.kicker\}/);
  assert.match(hero, /className=\{`\$\{styles\.kicker\} \$\{styles\.cockpitToggleKicker\}`\}/);
  assert.doesNotMatch(hero, /cockpitToggleLabel|cockpitToggleLogo/);
  assert.match(
    hero,
    /className=\{styles\.cockpitDetails\}[\s\S]*?<div className=\{styles\.generatorCard\}>/,
  );
  assert.match(css, /\.hero\s*\{[\s\S]*?grid-template-columns: 1\.05fr 0\.95fr/);
  assert.match(responsiveCockpit, /\.cockpitToggle\s*\{\s*display: none/);
  assert.match(responsiveCockpit, /\.cockpitDetails,\s*\.cockpitDetailsInner\s*\{\s*display: contents/);
  assert.match(responsiveCockpit, /@media \(max-width: 1100px\)/);
  assert.match(responsiveCockpit, /\.cockpitToggle\s*\{[\s\S]*?display: grid/);
  assert.match(
    responsiveCockpit,
    /\.cockpitToggle\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/,
  );
  assert.match(
    responsiveCockpit,
    /\.cockpitToggleKicker\s*\{[\s\S]*?grid-column: 2;[\s\S]*?align-self: center;[\s\S]*?justify-self: center/,
  );
  assert.match(
    responsiveCockpit,
    /\.cockpitChevron\s*\{[\s\S]*?grid-column: 3;[\s\S]*?align-self: center;[\s\S]*?justify-self: end/,
  );
  assert.match(responsiveCockpit, /\.cockpitDetails\s*\{[\s\S]*?grid-template-rows: 0fr/);
  assert.match(responsiveCockpit, /\.cockpitPanelOpen \.cockpitDetails\s*\{[\s\S]*?grid-template-rows: 1fr/);
  assert.match(responsiveCockpit, /\.hero\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
});

test("le Générateur conserve un en-tête strictement organisé sur deux lignes", () => {
  const hero = read("app/dashboard/_components/DashboardHero.tsx");
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(hero, /className=\{styles\.generatorTitle\}>\{t\.hero\.generatorTitle\}<\/div>/);
  assert.doesNotMatch(hero, /compactGeneratorTitle|generatorTitleFull|generatorTitleCompact/);
  assert.match(css, /\.generatorHeader\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.generatorHeaderCopy\s*\{\s*display: contents/);
  assert.match(css, /\.generatorHeaderLead\s*\{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 1/);
  assert.match(css, /\.generatorHeaderRight\s*\{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1/);
  assert.match(
    css,
    /\.generatorDesc\s*\{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;[\s\S]*?white-space: nowrap/,
  );
});
