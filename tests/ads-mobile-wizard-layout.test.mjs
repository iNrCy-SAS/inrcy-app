import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");

function fixture(channel) {
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}
    ${css}
    </style></head><body>
    <div style="height:76px"></div>
    <main class="workspace studioWorkspace" data-compact="true" data-analysis-setup="true">
      <nav class="stepper" aria-label="Étapes de création">${Array.from({ length: 10 }, (_, index) => `<button><span>${index + 1}</span></button>`).join("")}</nav>
      <section class="card studioChoiceCard">
        <header class="studioStepHeader"><span class="studioStepLabel">01 · LE CAP DE L’ANALYSE</span><h2><span class="studioTitleLong">Comment iNrCy doit-il vous guider ?</span><span class="studioTitleShort">Quel cap choisir ?</span></h2><span class="studioStepChannel">${channel}</span></header>
        <div class="studioAnalysisSetup">
          <fieldset class="studioAnalysisChoice"><legend>Mode d’analyse</legend><p>Votre iNrADN guide les deux parcours.</p><div role="radiogroup">
            <label data-selected="true"><input type="radio" checked><span><strong>Analyse libre iNrADN</strong><small>Une analyse de votre activité.</small><b>iNrCy choisit le cap</b></span></label>
            <label><input type="radio"><span><strong>Analyse par objectif précis</strong><small>Une analyse guidée.</small><b>Je fixe le cap</b></span></label>
          </div></fieldset>
          <div class="studioAnalysisSetupActions"><button class="back">← Choisir un autre parcours</button><button class="headerCta">Lancer l’analyse iNrCy →</button></div>
        </div>
      </section>
      <section class="card studioCard"><header class="studioStepHeader"><span class="studioStepLabel">02 · FONDATIONS</span><h2><span class="studioTitleLong">La direction de votre campagne.</span><span class="studioTitleShort">Votre objectif</span></h2><span class="studioStepChannel">${channel}</span></header><p class="intro studioOptionalIntro">Texte déjà expliqué par les champs.</p><div class="studioGrid"><label class="field">Nom de la campagne<input></label><label class="field">Objectif<select><option>Prospects</option></select></label></div></section>
    </main></body></html>`;
}

test("iNrADS wizard keeps compact titles, choices and actions readable on narrow phones", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[280, 568], [320, 568], [375, 667]]) {
      for (const channel of ["Meta Ads", "Google Ads", "LinkedIn Ads", "TikTok Ads", "Pinterest Ads", "X Ads"]) {
        const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
        try {
          await page.setContent(fixture(channel));
          const layout = await page.evaluate(() => {
            const choice = document.querySelector(".studioChoiceCard");
            const heading = choice.querySelector("h2");
            const action = choice.querySelector(".studioAnalysisSetupActions .headerCta");
            const form = document.querySelector(".studioCard");
            return {
              title: heading.innerText,
              titleOverflow: heading.scrollWidth > heading.clientWidth,
              actionBottom: action.getBoundingClientRect().bottom,
              actionRight: action.getBoundingClientRect().right,
              optionalIntro: getComputedStyle(form.querySelector(".studioOptionalIntro")).display,
              fieldMargin: getComputedStyle(form.querySelector(".field")).margin,
            };
          });
          const label = `${channel} ${width}×${height}: ${JSON.stringify(layout)}`;
          assert.equal(layout.title, "Quel cap choisir ?", label);
          assert.equal(layout.titleOverflow, false, label);
          assert.ok(layout.actionRight <= width && layout.actionBottom <= height, label);
          assert.equal(layout.optionalIntro, "none", label);
          assert.equal(layout.fieldMargin, "0px", label);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
});
