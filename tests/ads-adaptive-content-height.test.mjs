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
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#081126}
    ${css}
    </style></head><body>
    <main class="workspace studioWorkspace">
      <section class="card studioCard ${cardClass}" data-channel="linkedin">
        <header class="studioStepHeader"><span class="studioStepLabel">05 · SIGNAUX</span><h2>Vos signaux</h2><span class="studioStepChannel">LinkedIn Ads</span></header>
        <div class="studioGrid"><label class="field studioWide">Contenu<small>Un par ligne</small><textarea class="campaignTextarea studioAdaptiveContentTextarea" rows="6">${content}</textarea></label></div>
      </section>
    </main>
    <script>const field=document.querySelector("textarea");field.style.height="0px";field.style.height=(field.scrollHeight+2)+"px";</script>
    </body></html>`;
}

async function textareaLayout(page) {
  return page.locator("textarea").evaluate((field) => {
    const style = getComputedStyle(field);
    return {
      clientHeight: field.clientHeight,
      scrollHeight: field.scrollHeight,
      maxHeight: parseFloat(style.maxHeight),
      overflowY: style.overflowY,
    };
  });
}

test("les listes iNrADS utilisent le textarea auto-ajusté sans changer leur sauvegarde", () => {
  assert.match(client, /CampaignTextarea className=\{styles\.studioAdaptiveContentTextarea\} rows=\{6\} value=\{editableList\(draft\.keywords\)\}/);
  assert.match(client, /CampaignTextarea className=\{styles\.studioAdaptiveContentTextarea\} rows=\{3\} value=\{editableList\(draft\.urlExclusions\)\}/);
  assert.match(client, /updateDraft\(\{ keywords: parseEditableList\(event\.target\.value\.split\("\\n"\)\) \}\)/);
  assert.match(client, /updateDraft\(\{ urlExclusions: parseEditableList\(event\.target\.value\.split\("\\n"\)\) \}\)/);
});

test("un écran desktop haut montre les signaux usuels sans scroll interne et borne les listes extrêmes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.setContent(fixture());
    const normal = await textareaLayout(page);
    assert.ok(normal.clientHeight > 116, JSON.stringify(normal));
    assert.ok(normal.clientHeight >= normal.scrollHeight - 2, JSON.stringify(normal));

    await page.setContent(fixture({ content: Array.from({ length: 80 }, (_, index) => `Signal publicitaire détaillé ${index + 1}`).join("\n") }));
    const extreme = await textareaLayout(page);
    assert.ok(extreme.clientHeight <= 420, JSON.stringify(extreme));
    assert.ok(extreme.clientHeight < extreme.scrollHeight, JSON.stringify(extreme));
    assert.equal(extreme.overflowY, "auto");
  } finally {
    await browser.close();
  }
});

test("les écrans compacts gardent une hauteur mesurée et Diffusion grandit seulement quand la place le permet", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.setContent(fixture());
    await mobile.locator(".studioWorkspace").evaluate((workspace) => workspace.setAttribute("data-compact", "true"));
    const compact = await textareaLayout(mobile);
    assert.ok(compact.clientHeight <= 150, JSON.stringify(compact));
    await mobile.close();

    const desktop = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await desktop.setContent(fixture({ kind: "delivery", content: "https://example.test/mentions-legales\nhttps://example.test/recrutement" }));
    const delivery = await textareaLayout(desktop);
    assert.ok(delivery.clientHeight > 88, JSON.stringify(delivery));
    assert.ok(delivery.clientHeight <= 170, JSON.stringify(delivery));
    await desktop.close();
  } finally {
    await browser.close();
  }
});
