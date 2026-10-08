import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const settingsExports = {};
new Function("exports", ts.transpileModule(await readFile(new URL("../lib/adsPreparedCampaignSettings.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(settingsExports);
const components = {};
new Function("exports", "require", ts.transpileModule(await readFile(new URL("../app/dashboard/ads/PreparedAdsCampaignControls.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(components, (path) => path === "@/lib/adsPreparedCampaignSettings" ? settingsExports : path === "./ads.module.css" ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : require(path));
const noop = () => {};
function fixture(channel, stage, compact) {
  const settings = settingsExports.defaultPreparedDeliverySettings("total");
  settings.budget = { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-21T21:59:00Z" };
  settings.bidding = { strategy: channel === "tiktok" ? "cost_cap" : "max_bid", amountEuros: 1.5 };
  const draft = { provider: channel, preparedDeliverySettings: settings, dailyBudgetEuros: 25, endDate: "2026-10-21", targetLocations: ["Hauts-de-France", "Auvergne-Rhône-Alpes"], languages: ["Français"], targetAudiences: ["Indépendants et dirigeants de petites entreprises"], conversionGoal: "lead_form", conversionLocation: "website", destinationUrl: "https://inrcy.com/decouvrir/" + "nom-de-campagne".repeat(6), trackingParameters: "utm_source=" + channel + "&utm_campaign=" + "decouverte-de-la-plateforme".repeat(4), creativeUrl: "https://assets.example/" + "video-publicitaire".repeat(5) + ".mp4", imageUrl: "", channelSettings: channel === "tiktok" ? { channel, objectiveType: "TRAFFIC", format: "video", targetingMode: "interests", placementIntent: "tiktok_only", optimizationIntent: "clicks", destinationKind: "website" } : { channel, objective: "website_traffic", format: "video", targetingMode: "follower_lookalikes" } };
  const control = stage === "budget" ? components.PreparedAdsBudget : stage === "bidding" ? components.PreparedAdsBidding : components.PreparedAdsEffectiveSummary;
  const props = stage === "budget" ? { settings, dailyBudget: 25, endDate: draft.endDate, timeZone: "Europe/Paris", onChange: noop, onDailyChange: noop, onEndDateChange: noop } : stage === "bidding" ? { settings, budgetEuros: 200, channel, optimizationIntent: "clicks", onChange: noop } : { draft, timeZone: "Europe/Paris" };
  const markup = renderToStaticMarkup(createElement(control, props));
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#08111a}${css.replace(/:global\(([^)]+)\)/g, "$1")}.fixtureCanvas{width:calc(100% - 128px);height:calc(100dvh - 220px);margin:130px auto 0;padding:0}@media(max-width:999px){.fixtureCanvas{width:100%;height:auto;margin:0;padding:12px}}</style></head><body><main class="workspace studioWorkspace fixtureCanvas" data-channel="${channel}" ${compact ? 'data-compact="true"' : ""}><nav class="stepper" aria-label="Étapes de création">${Array.from({ length: 12 }, (_, index) => `<button type="button" aria-label="Étape ${index + 1}"><span>${index + 1}</span></button>`).join("")}</nav><section class="card studioCard ${stage === "summary" ? "studioValidationCard" : "studioBudgetCard"}" data-channel="${channel}"><header class="studioStepHeader"><span class="studioStepLabel">VOTRE CAMPAGNE</span><h2>${stage === "budget" ? "Budget et calendrier" : stage === "bidding" ? "Enchères" : "Réglages préparés"}</h2></header><div class="studioGrid">${markup}</div></section></main></body></html>`;
}
test("Actual X and TikTok prepared controls and long summaries remain full-width and accessible at four viewport sizes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1366, 768], [1707, 842]]) for (const channel of ["x", "tiktok"]) for (const stage of ["budget", "bidding", "summary"]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.setContent(fixture(channel, stage, width < 1000));
        const layout = await page.evaluate(() => {
          const card = document.querySelector(".studioCard"), workspace = document.querySelector(".studioWorkspace"), style = getComputedStyle(workspace), panel = card.querySelector("fieldset");
          return { page: document.documentElement.scrollWidth, viewport: innerWidth, card: card.clientWidth, scroll: card.scrollWidth, content: workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), panel: panel.clientWidth, panelScroll: panel.scrollWidth,
            overflows: [...card.querySelectorAll("input,select,button,fieldset,dd")].filter((element) => { const bounds = element.getBoundingClientRect(), parent = card.getBoundingClientRect(); return bounds.left < parent.left - 1 || bounds.right > parent.right + 1; }).map((element) => element.outerHTML.slice(0, 150)),
          };
        });
        const context = `${channel}/${stage} ${width}×${height}: ${JSON.stringify(layout)}`;
        assert.ok(layout.page <= layout.viewport + 1, context); assert.ok(layout.scroll <= layout.card + 1, context); assert.ok(layout.panelScroll <= layout.panel + 1, context);
        assert.ok(Math.abs(layout.card - layout.content) <= 3, context); assert.deepEqual(layout.overflows, [], context);
        if (stage === "summary") {
          assert.equal(await page.locator(".studioReviewGrid>div").count(), 21, context);
          assert.match(await page.locator("fieldset").textContent(), /Brouillon préparé · réglages non transmis/);
        } else {
          const controls = page.locator(".studioCard input,.studioCard select");
          assert.equal(await controls.count(), stage === "budget" ? 5 : 2, context);
          for (const control of await controls.all()) {
            await control.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
            const accessible = await control.evaluate((element) => { const bounds = element.getBoundingClientRect(); const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && (top === element || element.contains(top)); });
            assert.equal(accessible, true, context);
          }
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
