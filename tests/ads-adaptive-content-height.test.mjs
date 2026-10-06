import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const client = await readFile(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");

const normalSignals = [
  "Professionnels, artisans, commerçants et dirigeants de petites entreprises",
  "Responsables qui gèrent eux-mêmes leur communication digitale",
  "Entreprises locales souhaitant centraliser leurs publications",
  "Indépendants qui veulent gagner du temps chaque semaine",
  "Équipes recherchant une présence régulière sur les réseaux sociaux",
  "Commerces qui souhaitent développer leur visibilité locale",
].join("\n");

function fixture({ kind = "signals", content = normalSignals } = {}) {
  const cardClass = kind === "signals" ? "studioKeywordsCard" : "studioDeliveryCard";
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{height:100%;margin:0;font-family:Arial,sans-serif;background:#081126}
    ${css}
    </style></head><body>
    <main class="workspace studioWorkspace">
      <section class="card studioCard ${cardClass}" data-channel="linkedin">
        <header class="studioStepHeader"><span class="studioStepLabel">05 · SIGNAUX</span><h2>Vos signaux</h2><span class="studioStepChannel">LinkedIn Ads</span></header>
        <div class="studioGrid"><label class="field studioWide">Contenu<small>Un par ligne</small><textarea class="campaignTextarea studioAdaptiveContentTextarea" rows="6">${content}</textarea></label></div>
      </section>
    </main>
    </body></html>`;
}

async function sizeTextarea(page) {
  await page.locator("textarea").evaluate((field) => {
    field.style.height = "0px";
    field.style.height = `${field.scrollHeight + 2}px`;
  });
}

async function textareaLayout(page) {
  return page.locator("textarea").evaluate((field) => {
    const style = getComputedStyle(field);
    return {
      clientHeight: field.clientHeight,
      scrollHeight: field.scrollHeight,
      maxHeight: parseFloat(style.maxHeight),
      overflowY: style.overflowY,
      inlineHeight: field.style.height,
      cssHeight: style.height,
      parentHeight: field.parentElement?.clientHeight,
    };
  });
}

test("la déclaration politique garde NOT_POLITICAL et son point à la suite de la phrase", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2048, height: 1000 } });
    await page.setContent(`<!doctype html><html lang="fr"><style>${css}</style><main class="studioFinalActions">
      <label class="check studioRequiredCheck" data-linkedin-political-confirmation="true">
        <input type="checkbox" checked><span><strong>Déclaration politique LinkedIn obligatoire</strong>
        Je confirme qu’il ne s’agit pas de publicité politique. Aucune annonce de cette campagne ne constitue une publicité politique au regard du droit des pays ciblés, notamment du droit de l’Union européenne pour les publicités ciblant l’UE. Je respecte les politiques LinkedIn et les exigences réglementaires applicables. La campagne sera déclarée <b>NOT_POLITICAL</b>.</span>
      </label></main></html>`);
    const tops = await page.locator("[data-linkedin-political-confirmation] > span").evaluate((span) => {
      const keyword = span.querySelector("b");
      const before = keyword.previousSibling;
      const after = keyword.nextSibling;
      const phrase = document.createRange();
      const start = before.textContent.lastIndexOf("déclarée");
      phrase.setStart(before, start);
      phrase.setEnd(before, start + "déclarée".length);
      const period = document.createRange();
      period.selectNodeContents(after);
      return {
        phrase: phrase.getBoundingClientRect().top,
        keyword: keyword.getBoundingClientRect().top,
        period: period.getBoundingClientRect().top,
      };
    });
    assert.ok(Math.abs(tops.phrase - tops.keyword) < 2, JSON.stringify(tops));
    assert.ok(Math.abs(tops.keyword - tops.period) < 2, JSON.stringify(tops));
  } finally {
    await browser.close();
  }
});

test("les listes iNrADS utilisent le textarea auto-ajusté sans changer leur sauvegarde", () => {
  assert.match(client, /CampaignTextarea className=\{styles\.studioAdaptiveContentTextarea\} rows=\{6\} value=\{editableList\(draft\.keywords\)\}/);
  assert.match(client, /CampaignTextarea className=\{styles\.studioAdaptiveContentTextarea\} rows=\{3\} value=\{editableList\(draft\.urlExclusions\)\}/);
  assert.match(client, /updateDraft\(\{ keywords: parseEditableList\(event\.target\.value\.split\("\\n"\)\) \}\)/);
  assert.match(client, /updateDraft\(\{ urlExclusions: parseEditableList\(event\.target\.value\.split\("\\n"\)\) \}\)/);
  assert.match(client, /observer\.observe\(workspace, \{ attributes: true, attributeFilter: \["data-compact", "data-short", "data-stage"\] \}\)/);
});

test("LinkedIn montre toutes les phrases dans le champ et fait défiler la carte pour les longues listes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.setContent(fixture());
    await sizeTextarea(page);
    const normal = await textareaLayout(page);
    assert.ok(normal.clientHeight > 116, JSON.stringify(normal));
    assert.ok(normal.clientHeight >= normal.scrollHeight - 2, JSON.stringify(normal));

    await page.setContent(fixture({ content: Array.from({ length: 80 }, (_, index) => `Signal publicitaire détaillé ${index + 1}`).join("\n") }));
    await sizeTextarea(page);
    const extreme = await textareaLayout(page);
    assert.ok(extreme.clientHeight >= extreme.scrollHeight - 2, JSON.stringify(extreme));
    assert.equal(extreme.overflowY, "hidden");
    const card = await page.locator(".studioKeywordsCard").evaluate((section) => ({
      clientHeight: section.clientHeight,
      scrollHeight: section.scrollHeight,
    }));
    assert.ok(card.scrollHeight > card.clientHeight, JSON.stringify(card));
  } finally {
    await browser.close();
  }
});

test("les signaux LinkedIn restent visibles en compact et Diffusion garde sa hauteur bornée", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.setContent(fixture());
    await mobile.locator(".studioWorkspace").evaluate((workspace) => workspace.setAttribute("data-compact", "true"));
    await sizeTextarea(mobile);
    const compact = await textareaLayout(mobile);
    assert.ok(compact.clientHeight >= compact.scrollHeight - 2, JSON.stringify(compact));
    await mobile.close();

    const desktop = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await desktop.setContent(fixture({ kind: "delivery", content: "https://example.test/mentions-legales\nhttps://example.test/recrutement" }));
    await sizeTextarea(desktop);
    const delivery = await textareaLayout(desktop);
    assert.ok(delivery.clientHeight > 88, JSON.stringify(delivery));
    assert.ok(delivery.clientHeight <= 170, JSON.stringify(delivery));
    await desktop.close();
  } finally {
    await browser.close();
  }
});
