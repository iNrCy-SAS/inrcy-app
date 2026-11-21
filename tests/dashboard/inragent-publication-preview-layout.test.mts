import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { chromium } from "@playwright/test";
import ts from "typescript";
import { INR_AGENT_WORKSPACES } from "../../lib/inrAgentWorkspaces.ts";

const sourceText = readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("AgentClient.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const css = readFileSync(new URL("../../app/dashboard/agent/agent.module.css", import.meta.url), "utf8").replace(/:global\(([^)]+)\)/g, "$1");
const catalog = JSON.parse(readFileSync(new URL("../../messages/fr-FR/agent.json", import.meta.url), "utf8"));
const headerSource = ts.createSourceFile("AgentWorkspaceHeader.tsx", readFileSync(new URL("../../app/dashboard/agent/_components/AgentWorkspaceHeader.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const headerFunction = headerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AgentWorkspaceHeader");
assert.ok(headerFunction);
const headerJs = ts.transpileModule(headerFunction.getText(headerSource).replace("export default ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const Header = new Function("React", "styles", "appStyles", "useTranslations", "INR_AGENT_WORKSPACES", "HelpButton", "DashboardAssistantTrigger", `${headerJs};return AgentWorkspaceHeader;`)(
  { createElement, Fragment }, new Proxy({}, { get: (_, name) => `workspaceHeader_${String(name)}` }), new Proxy({}, { get: (_, name) => String(name) }),
  () => (key: string) => key.split(".").reduce((value, part) => value?.[part], catalog.workspaces) || key,
  INR_AGENT_WORKSPACES, () => createElement("button", { type: "button" }, "?"), () => null,
);
const headerCss = readFileSync(new URL("../../app/dashboard/agent/_components/AgentWorkspaceHeader.module.css", import.meta.url), "utf8")
  .replace(/\.([_a-zA-Z][\w-]*)/g, ".workspaceHeader_$1");
const bindings = new Map<string, ts.VariableDeclaration>();
let band: ts.JsxElement | undefined, preview: ts.JsxElement | undefined, failureNotice: ts.FunctionDeclaration | undefined;
let failureNoticeUses = 0;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node)) bindings.set(node.name.getText(source), node);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "PublicationFailureNotice") failureNotice = node;
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "PublicationFailureNotice") failureNoticeUses++;
  if (ts.isJsxElement(node)) {
    const attributes = node.openingElement.attributes.getText(source);
    if (attributes === "className={styles.publicationInfoBand} data-publication-info") band = node;
    if (/className=\{`\$\{styles\.publishPreview\}/.test(attributes)) preview = node;
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(band, "render the actual single publication info band");
assert.ok(preview, "inspect the actual preview child structure");
assert.ok(failureNotice);
let bandExpression: ts.Node = band.parent;
while (ts.isParenthesizedExpression(bandExpression)) bandExpression = bandExpression.parent;
assert.ok(ts.isConditionalExpression(bandExpression));
const declaration = (name: string) => { const node = bindings.get(name); assert.ok(node, name); return `const ${node.getText(source)};`; };
const compiled = ts.transpileModule(`${failureNotice.getText(source)}
function Info(props) {
 const { workspaceStatus, publishPreparationState, publishFailureMessage, notice = null, noMatchingPublications = false, scheduledEditSession = null } = props;
 const isPublishView = true, scheduledEditDirty = false;
 ${["publishPreparationStatus", "publicationPreparationMessage", "publicationErrorMessage", "publicationFeedbackMessage", "scheduledEditBanner"].map(declaration).join("\n")}
 return (${bandExpression.getText(source)});
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const Info = new Function("React", "styles", "i18nT", "PencilActionIcon", "exitScheduledEditSession", `${compiled};return Info;`)(
  { createElement }, new Proxy({}, { get: (_, name) => String(name) }), (key: string) => catalog[key] || key,
  () => createElement("svg", { "aria-hidden": true }), () => {},
);

type State = { name: string; workspaceStatus?: string; publishPreparationState?: string; publishFailureMessage?: string; notice?: string; scheduledEditSession?: object };
const states: State[] = [
  { name: "queued", publishPreparationState: "queued", workspaceStatus: catalog.next_editorial_publication_in_a_few_minutes },
  { name: "generating", publishPreparationState: "generating", workspaceStatus: catalog.agent_working_preparing },
  { name: "retry", publishPreparationState: "retry", publishFailureMessage: "La préparation reprendra automatiquement." },
  { name: "ready-tiktok", publishPreparationState: "scheduling_retry", publishFailureMessage: catalog.publication_scheduling_tiktok_review, notice: "Réglages enregistrés." },
  { name: "ready" },
  { name: "scheduled-edit", scheduledEditSession: {}, notice: "Réglages enregistrés." },
];

// Keep the native preview/parent classes and their content rows. All dimensions,
// including the five cards and responsive row wrapping, come from production CSS.
function fixture(state: State) {
  const info = renderToStaticMarkup(createElement(Info, state));
  const header = renderToStaticMarkup(createElement(Header, { workspace: "publications", enabled: true, busy: false, preparing: false, prepareDisabled: false }));
  const cards = ["Liste des canaux", "Canal consulté", "Contenu", "Média", "Options"].map((label, index) =>
    `<article class="campaignInfoCard ${index === 4 ? "publicationFormatCard" : ""}"><small class="publicationCardHeading">${label}</small><span class="campaignInfoIcon">✦</span><span><strong>${index === 1 ? "TikTok" : "Publication"}</strong></span></article>`).join("");
  return `<!doctype html><html lang="fr"><head><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,sans-serif}${css}${headerCss}</style></head>
  <body><main class="agentPage agentWorkspace" data-agent-workspace="publications"><section class="agentCanvas">
  ${header}${info}
  <div class="mainGrid"><div class="workColumn"><section class="previewCard previewCardNoFrame"><div class="previewBody">
  <div class="publishPreview"><nav class="publicationNavigation"><button>‹</button><strong>Publication 1 / 16</strong><button>›</button></nav>
  <div class="publishInfoGrid publishInfoGridWithFormat">${cards}</div>
  <div class="publishPostCarousel"><div class="publishPostStack"><article class="publishPostCard" data-has-media="true">
  <section class="publishInlineMedia" data-media-kind="image"><div class="publishInlineMediaStage"><img alt="Photo de publication" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='800' height='600' fill='%23306488'/%3E%3C/svg%3E"></div><div class="publishInlineMediaCaption"><span>Image</span><strong>Cyclicom</strong></div></section>
  <div class="publishPostText"><div class="publishTitleLine"><span>Titre</span><strong>Votre communication mérite de rayonner</strong></div><div class="publishPostContent"><p>Du contenu sérieux, humain et chaleureux pour votre entreprise.</p></div></div>
  </article></div></div></div></div>
  <footer class="previewMeta previewMetaPublish publishReviewFooter"><div class="dateItem"><strong>24 novembre à 14 h</strong></div><div class="publishFooterStatus"><strong>À valider</strong></div><div class="previewActions"><button>Valider</button></div></footer>
  </section></div></div></section></main></body></html>`;
}

test("publication messages have one shared location above navigation, retaining one public error alert", () => {
  assert.equal(failureNoticeUses, 1, "public errors must not be repeated inside the three hero branches");
  assert.doesNotMatch(preview!.getText(source), /PublicationFailureNotice|publicationPreparationNotice|publicationInfoBand/);
  assert.ok(sourceText.indexOf("styles.publicationInfoBand") < sourceText.indexOf("<AgentPublicationNavigation"));
  assert.match(sourceText, /status=\{isPublishView \? undefined : workspaceStatus\}/);
  assert.match(sourceText, /\{!isPublishView && notice &&/);
  const html = renderToStaticMarkup(createElement(Info, states[3]));
  assert.equal((html.match(/data-publication-info/g) || []).length, 1);
  assert.equal((html.match(/role="alert"/g) || []).length, 1);
  assert.ok(html.includes(catalog.publication_scheduling_tiktok_review));
  assert.ok(html.includes(catalog.publication_scheduling_retry));
  assert.equal(renderToStaticMarkup(createElement(Info, states[4])), "", "a ready publication has no empty banner");
  const edit = renderToStaticMarkup(createElement(Info, states[5]));
  assert.equal((edit.match(/<button/g) || []).length, 1, "the shared scheduled edit control is rendered once inside the band");
  assert.equal((sourceText.match(/className=\{styles\.workspaceEditBanner\}/g) || []).length, 1, "all workspaces reuse the same edit banner and exit control");
  assert.match(sourceText, /\{!isPublishView \? scheduledEditBanner : null\}/);
  const duplicate = renderToStaticMarkup(createElement(Info, { ...states[3], notice: catalog.publication_scheduling_tiktok_review }));
  assert.equal((duplicate.match(new RegExp(catalog.publication_scheduling_tiktok_review, "g")) || []).length, 1);
});

test("native publication cards, media and footer never overlap the shared information band at desktop, iPad and mobile sizes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 2560, height: 1346 }, { width: 1440, height: 900 }, { width: 1280, height: 650 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      try {
        for (const state of states) {
          await page.setContent(fixture(state));
          await page.locator(".publishInlineMediaStage img").evaluate((image: HTMLImageElement) => image.decode());
          const geometry = await page.evaluate(() => {
            const rect = (selector: string) => { const node = document.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
            return { header: rect("[data-agent-workspace-header]")!, band: rect(".publicationInfoBand"), nav: rect(".publicationNavigation")!, controls: rect(".publishInfoGrid")!, cards: [...document.querySelectorAll(".publishInfoGrid .campaignInfoCard")].map(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }), hero: rect(".publishPostCarousel")!, title: rect(".publishTitleLine")!, image: rect(".publishInlineMediaStage")!, footer: rect(".publishReviewFooter")!, horizontal: document.documentElement.scrollWidth > innerWidth + 1 };
          });
          const context = `${viewport.width}x${viewport.height} ${state.name}: ${JSON.stringify(geometry)}`;
          assert.equal(geometry.horizontal, false, context);
          if (geometry.band) {
            assert.ok(geometry.header.bottom <= geometry.band.top + 1, context);
            assert.ok(geometry.band.bottom <= geometry.nav.top + 1, context);
          } else assert.ok(geometry.header.bottom <= geometry.nav.top + 1, context);
          assert.ok(geometry.nav.bottom <= geometry.controls.top + 1, context);
          assert.ok(Math.max(...geometry.cards.map(card => card.bottom)) <= geometry.hero.top + 1, context);
          assert.ok(geometry.controls.bottom <= geometry.hero.top + 1, context);
          assert.ok(geometry.hero.height > 80, context);
          assert.ok(geometry.title.top >= geometry.controls.bottom - 1, context);
          assert.ok(geometry.image.top >= geometry.controls.bottom - 1, context);
          assert.ok(geometry.hero.bottom <= geometry.footer.top + 1, context);
          assert.equal(await page.locator(".publishPreview [role=alert], .publishPreview .publicationPreparationNotice").count(), 0);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
