import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const parsed = ts.createSourceFile("AdsClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const imageUrl = "https://ads-fixture.example/pin.svg";
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#2455aa"/><rect x="6" y="6" width="1068" height="1338" fill="none" stroke="white" stroke-width="12"/></svg>';

function component(name) {
  const node = parsed.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name);
  assert.ok(node, `${name} must be taken from the production component`);
  return node.getText(parsed);
}

let mediaSection, stepper, footer, stepNamesExpression;
function inspect(node) {
  if (ts.isJsxElement(node)) {
    const attrs = node.openingElement.attributes.getText(parsed);
    if (node.openingElement.tagName.getText(parsed) === "section" && attrs.includes("studioPureMediaCard")) mediaSection = node;
    if (attrs === "className={styles.stepper} aria-label=\"Étapes de création\"") stepper = node;
    if (attrs === "className={styles.wizardNavigation}") footer = node;
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "inrcyStepNames") stepNamesExpression = node.initializer;
  ts.forEachChild(node, inspect);
}
inspect(parsed);
assert.ok(mediaSection && stepper && footer && stepNamesExpression, "The real media section, footer and full stepper must be found");
const fixtureSource = `
const { useState } = require("react");
const styles = new Proxy({}, { get: (_, key) => String(key) });
${parsed.statements.find((entry) => ts.isVariableStatement(entry) && entry.declarationList.declarations[0].name.getText(parsed) === "PINTEREST_STEPPER_LABELS").getText(parsed)}
function Image({src,alt,className}) { return <img src={src} alt={alt} className={className} style={{position:"absolute",height:"100%",width:"100%",left:0,top:0,right:0,bottom:0}}/>; }
function LocalMediaUploadChoice({disabled,triggerLabel}) { return <button type="button" disabled={disabled}>{triggerLabel || "Ajouter une image"}</button>; }
${component("StudioStepHeader")}
${component("CampaignMediaPreview")}
export function PinterestMediaFixture({shortScreen,compactScreen}) {
  const channelId="pinterest", hasKeywordsStep=false, hasMediaStep=true;
  const step=6, mediaStep=6, analysisStep=1, deliveryStep=7, creationPath="inrcy", busy=null;
  const stepNames=${stepNamesExpression.getText(parsed)}, displayedStepNames=stepNames, displayedStepKeys=displayedStepNames, reachedStepKeys=displayedStepKeys, lastStep=stepNames.length-1;
  const channelMeta={label:"Pinterest Ads"}, nativeSettings={channel:"pinterest",intendedPromotionType:"STANDARD_AD",creativeType:"REGULAR"};
  const draft={name:"Cuisine en bois clair et rangements en colonnes",creativeType:"image",creativeUrl:${JSON.stringify(imageUrl)},imageUrl:${JSON.stringify(imageUrl)},mediaStrategy:"image",mediaBrief:"Cuisine en bois clair, cadrage portrait 4:5."};
  const attachedCampaignMediaUrl=draft.imageUrl, nativeMediaUpload=true, googleSearchMedia=false, nativeMediaStrategy="image";
  const campaignMediaUploadBusy=false, campaignMediaUploadError=null, campaignImageInputRef={current:null}, campaignVideoInputRef={current:null};
  const analysisProposalReady=false, planProgress=100, destinationReview={required:false,canContinue:true};
  const nativeWizardFormat=()=>"image unique", updateDraft=()=>{}, setCampaignMediaStudioOpen=()=>{}, setCampaignMediaLibraryOpen=()=>{}, handleCampaignMediaUpload=()=>{}, navigateToStep=()=>{}, setStep=()=>{};
  return <main className={styles.workspace + " " + styles.studioWorkspace} data-compact={compactScreen||undefined} data-short={shortScreen||undefined} data-stage={step} data-creation-path={creationPath}>
    ${stepper.getText(parsed)}
    ${mediaSection.getText(parsed)}
    ${footer.getText(parsed)}
  </main>;
}`;
const compiled = ts.transpileModule(fixtureSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const moduleExports = {};
new Function("exports", "require", compiled)(moduleExports, require);

function fixture(width, height) {
  const markup = renderToStaticMarkup(createElement(moduleExports.PinterestMediaFixture, { compactScreen: width < 1000 || height < 660, shortScreen: height <= 600 }));
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#0b1636}
    ${css.replace(/:global\(([^)]+)\)/g, "$1")}
    .drawerScroll{height:calc(100dvh - 76px);min-height:0;overflow-x:hidden;overflow-y:auto;padding:12px 16px 16px}
  </style></head><body><header style="height:76px">iNr’ADS — Créer une campagne Pinterest</header><div class="drawerScroll" data-dashboard-settings-drawer-scroll="true">${markup}</div></body></html>`;
}

test("Pinterest keeps its real portrait, controls and ten steps accessible across phone, tablet and desktop", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [375, 667], [768, 1024], [1024, 768], [1366, 768], [1707, 842]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.route("**/*", (route) => route.request().url() === imageUrl
          ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: image })
          : route.abort());
        await page.setContent(fixture(width, height));
        await page.locator(".campaignMediaPreviewImage").evaluate((element) => element.decode());
        const result = await page.evaluate(() => {
          const element = (selector) => document.querySelector(selector);
          const rect = (selector) => { const { top, bottom, left, right, width, height } = element(selector).getBoundingClientRect(); return { top, bottom, left, right, width, height }; };
          const card = element(".studioPureMediaCard"), image = element(".campaignMediaPreviewImage"), stepper = element(".stepper");
          const areas = Object.fromEntries([".campaignMediaPreview", ".campaignMediaWorkspaceHeading", ".campaignMediaActions", ".campaignMediaAttached", ".wizardNavigation", ".studioPureMediaCard"].map((selector) => [selector, rect(selector)]));
          const croppedText = [...card.querySelectorAll("strong,small,button,summary")].filter((node) => node.clientWidth > 0 && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)).map((node) => node.textContent);
          return { ...areas, cardClientHeight: card.clientHeight, cardScrollHeight: card.scrollHeight, cardScrollTop: card.scrollTop,
            stepperWidth: stepper.clientWidth, stepperScrollWidth: stepper.scrollWidth, labels: [...stepper.querySelectorAll("button")].map((node) => node.getAttribute("aria-label")),
            imageFit: getComputedStyle(image).objectFit, image: rect(".campaignMediaPreviewImage"), natural: [image.naturalWidth, image.naturalHeight],
            externalLinkClosed: !element(".campaignExternalMedia").open, croppedText, pageOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        const details = `${width}×${height}: ${JSON.stringify(result)}`;
        const preview = result[".campaignMediaPreview"], card = result[".studioPureMediaCard"], footer = result[".wizardNavigation"];
        assert.equal(result.labels.length, 10, details);
        assert.ok(result.labels.some((label) => label.includes("Destination & mesure")), details);
        assert.ok(result.stepperScrollWidth <= result.stepperWidth + 1, details);
        if (width >= 1000) assert.ok(result.cardScrollHeight <= result.cardClientHeight + 1, details);
        assert.equal(result.cardScrollTop, 0, details);
        assert.equal(result.pageOverflow, false, details);
        assert.equal(result.externalLinkClosed, true, details);
        assert.deepEqual(result.croppedText, [], details);
        assert.equal(result.imageFit, "contain", details);
        assert.deepEqual(result.natural, [1080, 1350], details);
        assert.ok(preview.top >= card.top && preview.bottom <= card.bottom + 1, details);
        assert.ok(result.image.left >= preview.left && result.image.right <= preview.right && result.image.top >= preview.top && result.image.bottom <= preview.bottom, details);
        for (const selector of width >= 1000 ? [".campaignMediaWorkspaceHeading", ".campaignMediaActions", ".campaignMediaAttached"] : []) {
          assert.ok(result[selector].left >= preview.right && result[selector].right <= card.right, details);
          assert.ok(result[selector].top >= card.top && result[selector].bottom <= card.bottom, details);
        }
        if (width >= 1000) assert.ok(footer.top >= card.bottom && footer.bottom <= height, details);
        for (const control of [page.locator(".campaignMediaPreview"), page.getByRole("button", { name: "Ajouter une image", exact: true }), page.getByRole("button", { name: "Générer", exact: true }), page.getByRole("button", { name: "Médiathèque", exact: true }), page.getByRole("button", { name: "Retirer", exact: true }), page.getByRole("button", { name: "Suivant →", exact: true })]) {
          await control.scrollIntoViewIfNeeded();
          assert.equal(await control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1 && (top === element || element.contains(top));
          }), true, `${details}: media or control is inaccessible`);
        }
        if (width >= 1000) assert.equal(await page.locator(".studioPureMediaCard").evaluate((element) => element.scrollTop), 0, details);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
