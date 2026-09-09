import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const campaignModals = [
  "app/dashboard/propulser/components/offrir/OffrirModal.tsx",
  "app/dashboard/propulser/components/valoriser/ValoriserModal.tsx",
  "app/dashboard/propulser/components/recolter/RecolterModal.tsx",
  "app/dashboard/fideliser/components/suivre/SuivreModal.tsx",
  "app/dashboard/fideliser/components/informer/InformerModal.tsx",
  "app/dashboard/fideliser/components/enqueter/EnqueterModal.tsx",
] as const;

test("campaign template title and helper share the desktop row when space permits", () => {
  const css = read("app/dashboard/dashboard.module.css");
  const intro = css.match(/^\.campaignTemplateIntro\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const title = css.match(/^\.campaignTemplateIntro\s*>\s*\.blockTitle\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const helper = css.match(/^\.campaignTemplateIntro\s*>\s*\.subtitle\s*\{[\s\S]*?\}/m)?.[0] ?? "";

  assert.match(intro, /display:\s*flex/);
  assert.match(intro, /flex-wrap:\s*wrap/);
  assert.match(title, /white-space:\s*nowrap/);
  assert.match(helper, /flex:\s*1 1 440px/);

  for (const path of campaignModals) {
    assert.match(read(path), /styles\.campaignTemplateIntro/, `${path} should use the shared responsive intro row`);
  }
});

test("all campaign editors expose the full-screen message control", () => {
  const editor = read("app/dashboard/_components/RichMailEditor.tsx");

  assert.match(editor, /allowFullscreen\?:\s*boolean/);
  assert.match(editor, /const showExpandControl = mobileFullscreen \|\| allowFullscreen/);
  assert.match(editor, /bottom:\s*mobileFullscreen[\s\S]*?:\s*0,/);

  for (const path of campaignModals) {
    assert.match(read(path), /<RichMailEditor[\s\S]*?allowFullscreen[\s\S]*?\/>/, `${path} should enable full-screen editing`);
  }
});

test("generated campaign templates update subject and message as one complete result", () => {
  for (const path of campaignModals) {
    const source = read(path);
    assert.match(source, /const nextSubject = String\(j\?\.subject \|\| ""\)\.trim\(\)/);
    assert.match(source, /const nextBody = String\(j\?\.body_text \|\| ""\)\.trim\(\)/);
    assert.match(source, /if \(!nextSubject \|\| !nextBody\)/);
    assert.match(source, /setSubject\(nextSubject\)[\s\S]*?setBody\(nextBody\)[\s\S]*?setBodyHtml\(textToRichMailHtml\(nextBody\)\)/);
  }
});

test("rich mail editor restores external generated HTML even after its cache changes", () => {
  const editor = read("app/dashboard/_components/RichMailEditor.tsx");

  assert.doesNotMatch(editor, /if \(lastHtmlRef\.current === nextHtml\) return/);
  assert.match(editor, /if \(node\.innerHTML === nextHtml\) \{[\s\S]*?lastHtmlRef\.current = nextHtml;[\s\S]*?return;[\s\S]*?node\.innerHTML = nextHtml;/);
});
