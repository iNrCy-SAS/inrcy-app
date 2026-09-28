import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/dashboard/ads/AdsCampaignDemoDialog.module.css", import.meta.url), "utf8");

function fixture() {
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}${css}
    </style></head><body><main><div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="description">
      <div class="header"><span class="brandMark">✦</span><div class="brand">iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div><button class="close">×</button></div>
      <div class="content"><span class="eyebrow">VOTRE VALIDATION</span><h2 id="title">Créer votre démo en pause ?</h2><p id="description">Vérifiez la campagne et le compte associé avant de confirmer. La création sur la plateforme se fera en pause, sans activation ni dépense.</p>
      <dl class="summary"><div><dt>Campagne</dt><dd>iNrCy – Search – Essai gratuit 21 jours – France</dd></div><div><dt>Canal</dt><dd>Google Ads</dd></div><div><dt>Compte annonceur</dt><dd>Compte publicitaire professionnel très long<small>6547075545</small></dd></div><div><dt>Statut</dt><dd class="paused">En pause · aucune dépense</dd></div></dl>
      <div class="actions"><button class="secondary">Annuler</button><button class="primary">Confirmer la démo en pause</button></div></div>
    </div></div></main></body></html>`;
}

test("la confirmation iNr’ADS reste lisible et actionnable sur mobile et desktop", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[280, 568], [320, 568], [375, 667], [1440, 900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.setContent(fixture());
        const dialog = page.getByRole("dialog", { name: "Créer votre démo en pause ?" });
        const bounds = await dialog.boundingBox();
        assert.ok(bounds, `${width}×${height}: dialogue absent`);
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}×${height}: débordement horizontal`);
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height, `${width}×${height}: débordement vertical`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}×${height}: scroll horizontal`);
        const confirm = page.getByRole("button", { name: "Confirmer la démo en pause" });
        await confirm.scrollIntoViewIfNeeded();
        assert.equal(await confirm.isVisible(), true, `${width}×${height}: action finale masquée`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
