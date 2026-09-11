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
  assert.match(editor, /createPortal\(editor, document\.body\)/);

  for (const path of campaignModals) {
    assert.match(read(path), /<RichMailEditor[\s\S]*?allowFullscreen[\s\S]*?\/>/, `${path} should enable full-screen editing`);
  }
});

test("full-screen campaign editors keep the subject and AI generation controls available", () => {
  const editor = read("app/dashboard/_components/RichMailEditor.tsx");
  const header = read("app/dashboard/_components/CampaignFullscreenComposerHeader.tsx");
  const headerCss = read("app/dashboard/_components/CampaignFullscreenComposerHeader.module.css");

  assert.match(editor, /fullscreenHeader\?:\s*React\.ReactNode/);
  assert.match(editor, /isExpanded && fullscreenHeader/);
  assert.match(editor, /data-campaign-fullscreen-header/);

  assert.match(header, /value=\{subject\}/);
  assert.match(header, /value=\{selectedKey\}/);
  assert.match(header, /<TemplateAiEngineSelector/);
  assert.match(header, /onClick=\{onGenerate\}/);
  assert.match(header, /value=\{selectedKey\}[\s\S]*?<TemplateAiEngineSelector[\s\S]*?value=\{subject\}/);
  assert.match(headerCss, /grid-template-columns:[\s\S]*?minmax\(280px, 1\.2fr\)/);
  assert.match(headerCss, /\.subjectField\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
  assert.match(headerCss, /@media \(max-width: 1180px\)/);
  assert.match(headerCss, /@media \(max-width: 680px\)/);

  for (const path of campaignModals) {
    const source = read(path);
    assert.match(source, /import CampaignFullscreenComposerHeader/);
    assert.match(
      source,
      /fullscreenHeader=\{[\s\S]*?<CampaignFullscreenComposerHeader[\s\S]*?subject=\{subject\}[\s\S]*?selectedKey=\{selectedKey\}[\s\S]*?aiEngine=\{aiEngine\}[\s\S]*?onGenerate=\{generateAiTemplateContent\}/,
      `${path} should expose the live campaign controls in full-screen mode`,
    );
  }
});

test("full-screen campaign header masks decorative dashboard layers", () => {
  const css = read("app/dashboard/_components/CampaignFullscreenComposerHeader.module.css");
  const shell = css.match(/^\.shell\s*\{[\s\S]*?^\}/m)?.[0] ?? "";

  assert.match(shell, /isolation:\s*isolate/);
  assert.match(shell, /overflow:\s*clip/);
  assert.match(shell, /background-color:\s*rgb\(10, 42, 76\)/);
  assert.match(shell, /background-image:\s*linear-gradient\([\s\S]*?rgb\(10, 42, 76\)[\s\S]*?rgb\(51, 24, 68\)/);
  assert.doesNotMatch(shell, /background(?:-image)?:[\s\S]*?radial-gradient/);
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
