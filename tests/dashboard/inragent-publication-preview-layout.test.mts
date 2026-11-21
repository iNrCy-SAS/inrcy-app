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
let article: ts.JsxElement | undefined;
let filterEmpty: ts.JsxElement | undefined;
let failureNotice: ts.FunctionDeclaration | undefined;
let workingIndicator: ts.FunctionDeclaration | undefined;
let failureNoticeUses = 0;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node)) bindings.set(node.name.getText(source), node);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "PublicationFailureNotice") failureNotice = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "AgentWorkingIndicator") workingIndicator = node;
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "PublicationFailureNotice") failureNoticeUses++;
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "article" &&
      node.openingElement.attributes.getText(source).includes("className={styles.publishPostCard}")) article = node;
  if (ts.isJsxElement(node) && node.openingElement.attributes.getText(source) === "className={styles.publicationFilterEmpty}") filterEmpty = node;
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(article, "render the production article and its real content branches");
assert.ok(filterEmpty);
assert.ok(failureNotice);
assert.ok(workingIndicator);
const declaration = (name: string) => {
  const node = bindings.get(name);
  assert.ok(node, name);
  return `const ${node.getText(source)};`;
};

const compiled = ts.transpileModule(`${failureNotice.getText(source)}
${workingIndicator.getText(source)}
function Publication(props) {
 const { publishPreparationState, publishFailureMessage, notice, scheduledEditSession, selectedPreparedAction,
   preparedChannelPreview, publishParagraphs, publishMediaPreview, activePublicationChannelEmpty, publishMediaOnly,
   activePreviewChannel = "site_web", pinterestBoardsError, noMatchingPublications = false, isInstantPublicationPreview = false } = props;
 const isPublishView = true, scheduledEditDirty = false;
 const publishPreparationInProgress = publishPreparationState === "generating";
 const workspace = "publications", loadState = "ready", agentWorking = publishPreparationInProgress;
 const agentWorkingLabel = i18nT("agent_working_preparing"), prepareProgress = { percent: 37 };
 const editorialGenerationActive = agentWorking, editorialQueueWaitingForCron = publishPreparationState === "queued";
 const activeAccountId = "fixture", publishPlacement = "story", manualPlanningOnly = false;
 const asRecord = value => value && typeof value === "object" ? value : null;
 ${["showEditorialCronWait", "workspaceStatus", "publishPreparationStatus", "showPublicationSpinner", "publicationAwaitingContent", "showGenerationProgress", "publicationPreparationMessage", "publicationErrorMessage", "publicationChannelMessage", "publicationFeedbackMessage", "scheduledEditBanner", "publicationInfoBand"].map(declaration).join("\n")}
 return noMatchingPublications ? (${filterEmpty.getText(source)}) : (${article.getText(source)});
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const Publication = new Function("React", "styles", "i18nT", "PencilActionIcon", "exitScheduledEditSession", "AgentMediaImage", "renderRichInlineText", `${compiled};return Publication;`)(
  { createElement, Fragment }, new Proxy({}, { get: (_, name) => String(name) }), (key: string) => catalog[key] || key,
  () => createElement("svg", { "aria-hidden": true }), () => {},
  ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }), (text: string) => text,
);

type State = { name: string; pending?: boolean; isInstantPublicationPreview?: boolean; publishPreparationState?: string; publishFailureMessage?: string; notice?: string; scheduledEditSession?: object; activePublicationChannelEmpty?: boolean; publishMediaOnly?: boolean; activePreviewChannel?: string; pinterestBoardsError?: string; noMatchingPublications?: boolean };
const states: State[] = [
  { name: "queued", pending: true, publishPreparationState: "queued" },
  { name: "generating", pending: true, publishPreparationState: "generating" },
  { name: "retry", pending: true, publishPreparationState: "retry", publishFailureMessage: "La préparation reprendra automatiquement." },
  { name: "ready-tiktok", publishPreparationState: "scheduling_retry", publishFailureMessage: catalog.publication_scheduling_tiktok_review, notice: "Réglages enregistrés." },
  { name: "ready" },
  { name: "scheduled-edit", scheduledEditSession: {}, notice: "Réglages enregistrés." },
  { name: "empty-channel", activePublicationChannelEmpty: true, notice: "Réglages enregistrés." },
  { name: "media-only", publishMediaOnly: true, notice: "Réglages enregistrés." },
  { name: "failed-generation", pending: true, publishPreparationState: "failed", publishFailureMessage: "La préparation a échoué." },
  { name: "failed-scheduling", publishPreparationState: "failed", publishFailureMessage: "La programmation a échoué." },
  { name: "pinterest", activePreviewChannel: "pinterest", pinterestBoardsError: "Tableau indisponible." },
  { name: "instant", pending: true, isInstantPublicationPreview: true },
];

const preparedTitle = "Votre communication mérite de rayonner";
const preparedBody = "Du contenu utile pour votre entreprise.";
const placeholderTitle = "Publication iNr’Agent en préparation";
const placeholderBody = "iNr’Agent prépare ce contenu à l’avance selon vos critères.";
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='800' height='600' fill='%23306488'/%3E%3C/svg%3E";
function renderPublication(state: State) {
  return renderToStaticMarkup(createElement(Publication, {
    ...state,
    selectedPreparedAction: { id: "publication", title: state.pending ? placeholderTitle : preparedTitle, summary: state.pending ? placeholderBody : preparedBody, payload: { editorialPlan: { state: state.pending ? "queued" : "ready" } } },
    preparedChannelPreview: state.pending ? null : { title: preparedTitle, body: preparedBody, hashtags: [] },
    publishParagraphs: state.pending ? [placeholderBody] : [preparedBody],
    publishMediaPreview: state.pending ? null : { url: image, kind: "image", activeIndex: 0, items: [{}], name: "Image de publication", typeLabel: "Image" },
  }));
}

function fixture(state: State) {
  const header = renderToStaticMarkup(createElement(Header, { workspace: "publications", enabled: true, busy: false, preparing: false, prepareDisabled: false }));
  const cards = ["Liste des canaux", "Canal consulté", "Contenu", "Média", "Options"].map((label, index) =>
    `<article class="campaignInfoCard ${index === 4 ? "publicationFormatCard" : ""}"><small class="publicationCardHeading">${label}</small><span class="campaignInfoIcon">✦</span><span><strong>${index === 1 ? "Site web" : "Publication"}</strong></span></article>`).join("");
  return `<!doctype html><html lang="fr"><head><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,sans-serif}${css}${headerCss}</style></head>
  <body><main class="agentPage agentWorkspace" data-agent-workspace="publications"><section class="agentCanvas">${header}
  <div class="mainGrid"><div class="workColumn"><section class="previewCard previewCardNoFrame"><div class="previewBody">
  <div class="publishPreview"><nav class="publicationNavigation"><button>‹</button><strong>Publication 1 / 16</strong><button>›</button></nav>
  <div class="publishInfoGrid publishInfoGridWithFormat">${cards}</div>
  <div class="publishPostCarousel"><div class="publishPostStack">${renderPublication(state)}
  <div class="publishCtaStandalone"><div class="publishCtaLine"><span>CTA</span><strong>—</strong></div></div></div></div></div></div>
  <footer class="previewMeta previewMetaPublish publishReviewFooter"><div class="dateItem"><strong>24 novembre à 14 h</strong></div><div class="publishFooterStatus"><strong>À valider</strong></div><div class="previewActions"><button>Valider</button></div></footer>
  </section></div></div></section></main></body></html>`;
}

test("the selected publication owns its messages and replaces the provisional content until prepared", () => {
  assert.equal(failureNoticeUses, 1, "render each public error once");
  assert.match(sourceText, /status=\{isPublishView \? undefined : workspaceStatus\}/);
  assert.match(sourceText, /\{!isPublishView && notice &&/);
  assert.equal((sourceText.match(/\{publicationInfoBand\}/g) || []).length, 2, "the article and its mutually exclusive filtered empty state own the messages");
  for (const state of states) {
    const html = renderPublication(state);
    const expectedSpinners = ["queued", "generating", "instant"].includes(state.name) ? 1 : 0;
    assert.equal((html.match(/role="progressbar"/g) || []).length, expectedSpinners, state.name);
    assert.equal(html.includes('aria-valuenow="37"'), Boolean(state.isInstantPublicationPreview), state.name);
    assert.equal((html.match(/data-publication-info/g) || []).length, state.name === "ready" ? 0 : 1, state.name);
    assert.ok(!html.includes(placeholderTitle) && !html.includes(placeholderBody), state.name);
    if (!state.pending && !state.activePublicationChannelEmpty && !state.publishMediaOnly) {
      assert.ok(html.includes(preparedTitle) && html.includes(preparedBody), state.name);
    }
  }
  const readyWithError = renderPublication(states[3]);
  assert.equal((readyWithError.match(/role="alert"/g) || []).length, 1);
  assert.ok(readyWithError.includes(catalog.publication_scheduling_tiktok_review));
  assert.ok(readyWithError.includes(catalog.publication_scheduling_retry));
  const duplicate = renderPublication({ ...states[3], notice: catalog.publication_scheduling_tiktok_review });
  assert.equal(duplicate.split(catalog.publication_scheduling_tiktok_review).length - 1, 1);
  assert.ok(renderPublication(states[1]).includes("37%"));
  assert.equal((renderPublication(states[0]).match(/role="status"/g) || []).length, 1, "only the selected publication queue message is displayed");
  assert.equal((renderPublication(states[1]).match(/role="status"/g) || []).length, 1, "a live progress percentage replaces the generic preparation message");
  const filtered = renderPublication({ name: "filtered", noMatchingPublications: true, notice: "Réglages enregistrés." });
  assert.ok(filtered.includes("Réglages enregistrés.") && filtered.includes(catalog.publication_filter_empty));
  assert.equal(renderPublication(states[5]).split(catalog.quitter_l_edition_08b3f0cb).length - 1, 1);
});

test("the five controls, publication content and footer stay ordered and readable across screen sizes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 2560, height: 1346 }, { width: 1440, height: 900 }, { width: 1280, height: 650 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      try {
        for (const state of states) {
          await page.setContent(fixture(state));
          await page.locator(".publishInlineMediaStage img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
          const geometry = await page.evaluate(() => {
            const rect = (selector: string) => {
              const r = document.querySelector(selector)?.getBoundingClientRect();
              return r && { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
            };
            return {
              nav: rect(".publicationNavigation")!, controls: rect(".publishInfoGrid")!,
              cards: [...document.querySelectorAll(".publishInfoGrid .campaignInfoCard")].map(node => node.getBoundingClientRect().bottom),
              hero: rect(".publishPostCard")!, band: rect("[data-publication-info]"),
              spinner: rect("[data-publication-spinner]"), status: rect("[data-publication-info] [role=status]"),
              title: rect(".publishTitleLine"), footer: rect(".publishReviewFooter")!, cta: rect(".publishCtaStandalone")!,
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            };
          });
          const context = `${viewport.width}x${viewport.height} ${state.name}: ${JSON.stringify(geometry)}`;
          assert.equal(geometry.horizontalOverflow, false, context);
          assert.equal(geometry.cards.length, 5, context);
          assert.ok(geometry.nav.bottom <= geometry.controls.top + 1, context);
          assert.ok(Math.max(...geometry.cards) <= geometry.hero.top + 1, context);
          const contentGap = geometry.hero.top - geometry.controls.bottom;
          assert.ok(contentGap >= -1 && contentGap <= 32, context);
          assert.ok(geometry.hero.height > 0, context);
          assert.ok(geometry.hero.bottom <= geometry.cta.top + 1, context);
          assert.ok(geometry.cta.bottom <= geometry.footer.top + 1, context);
          if (geometry.spinner) {
            const spinner = geometry.spinner, hero = geometry.hero;
            assert.ok(Math.abs((spinner.left + spinner.right - hero.left - hero.right) / 2) <= 1, context);
            assert.ok(Math.abs((spinner.top + spinner.bottom - hero.top - hero.bottom) / 2) <= 1, context);
            assert.ok(geometry.status && geometry.status.top >= spinner.bottom, context);
          }
          if (geometry.band) {
            assert.ok(geometry.band.top >= geometry.hero.top - 1 && geometry.band.bottom <= geometry.hero.bottom + 1, context);
            assert.ok(geometry.band.left >= geometry.hero.left - 1 && geometry.band.right <= geometry.hero.right + 1, context);
            if (geometry.title) assert.ok(geometry.band.bottom <= geometry.title.top + 1, context);
            const messages = page.locator("[data-publication-info] [role=status], [data-publication-info] [role=alert]");
            assert.ok(await messages.count() > 0, context);
            for (const message of await messages.all()) {
              await message.scrollIntoViewIfNeeded({ timeout: 2000 });
              const unobscured = await message.evaluate(node => {
                const r = node.getBoundingClientRect();
                const topmost = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return r.width > 0 && r.height > 0 && node.contains(topmost);
              });
              assert.ok(unobscured, context);
            }
          }
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
