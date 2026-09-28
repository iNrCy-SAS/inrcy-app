import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");

function copyField(label, singular, count, max) {
  return `<fieldset class="field googleAdCopyField"><legend>${label}</legend><small>Minimum requis</small>
    <div class="googleAdCopyRows">${Array.from({ length: count }, (_, index) =>
      `<div class="googleAdCopyRow"><label>${singular} ${index + 1}</label><input value="Exemple" /><span>7/${max}</span><button>×</button></div>`,
    ).join("")}</div>${count < 5 ? "" : '<button class="googleAdCopyAdd">+ Ajouter un titre</button>'}</fieldset>`;
}

function fixture() {
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#0b1636}${css}
    </style></head><body><main class="studioWorkspace" style="width:min(100%,1900px);margin:auto;padding:30px">
      <section class="studioGrid">${copyField("Titres", "Titre", 5, 30)}${copyField("Descriptions", "Description", 4, 90)}</section>
      <nav class="wizardNavigation"><button class="back">Précédent</button><span>8 / 10</span><div class="wizardNextGroup">
        <label class="wizardRequiredCheck"><input type="checkbox" /><span><strong>Validation obligatoire</strong>Je confirme ce lien</span></label>
        <button class="headerCta">Suivant →</button>
      </div></nav>
      <div class="studioFinalActions" data-channel="google"><label class="check studioRequiredCheck"><input type="checkbox" /><span><strong>Obligatoire avant création sur Google Ads</strong>Je certifie que cette campagne ne contient pas de publicité politique ciblant l’Union européenne.</span></label><button class="primaryButton studioDemoCampaignButton">Créer une démo en pause</button></div>
    </main></body></html>`;
}

test("les descriptions débutent au niveau des titres et les validations restent près des boutons", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent(fixture());
        const titlesTop = await page.locator(".googleAdCopyField").nth(0).locator("input").first().evaluate((element) => element.getBoundingClientRect().top);
        const descriptionsTop = await page.locator(".googleAdCopyField").nth(1).locator("input").first().evaluate((element) => element.getBoundingClientRect().top);
        const descriptionLegendBottom = await page.locator(".googleAdCopyField").nth(1).locator("legend").evaluate((element) => element.getBoundingClientRect().bottom);
        assert.ok(descriptionsTop - descriptionLegendBottom < 45, `${width}px : les descriptions sont trop éloignées de leur titre`);
        if (width >= 800) assert.ok(Math.abs(descriptionsTop - titlesTop) < 12, `${width}px : les titres et descriptions ne sont pas alignés`);

        const requiredInput = page.locator(".wizardRequiredCheck input");
        const inputBounds = await requiredInput.boundingBox();
        const nextBounds = await page.getByRole("button", { name: "Suivant" }).boundingBox();
        assert.ok(inputBounds && inputBounds.width >= 20 && inputBounds.height >= 20, `${width}px : case obligatoire trop petite`);
        assert.ok(nextBounds && inputBounds.y <= nextBounds.y + nextBounds.height + 10, `${width}px : case éloignée du bouton Suivant`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px : débordement horizontal`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
