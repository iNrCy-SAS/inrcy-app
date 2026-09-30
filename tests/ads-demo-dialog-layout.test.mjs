import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const css = await readFile(new URL("../app/dashboard/ads/AdsCampaignDemoDialog.module.css", import.meta.url), "utf8");
const source = await readFile(new URL("../app/dashboard/ads/AdsCampaignDemoDialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const moduleExports = {};
new Function("exports", "require", "document", compiled)(moduleExports, (name) => {
  if (name === "react-dom") return { createPortal: (children) => children };
  if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
  if (name === "@/lib/adsPublicationProgress") return { nextAdsPublicationProgress: (phase) => phase };
  return require(name);
}, { body: {} });

function fixture({ mode = "confirm", launchStatus = "active", channel = "Google Ads" } = {}) {
  // Render the real component; only its portal and CSS-module mapping are simulated.
  const markup = renderToStaticMarkup(createElement(moduleExports.default, {
    mode, launchStatus, busy: false, activeEnabled: true, pausedEnabled: true, publicationPhase: mode === "success" ? "success" : "idle",
    details: {
      campaignName: "iNrCy – Search – Essai 21 j – Gain de temps multicanal – Pros locaux",
      channelLabel: channel, accountName: "iNrCy — Compte publicitaire professionnel", accountId: "6547075545",
    },
    declarationLabel: `Je valide le compte, la campagne et la facturation directe par ${channel}, et je confirme le lancement en statut ${launchStatus === "active" ? "Active" : "En pause"}.`,
    declarationChecked: true,
    onDeclarationChange() {}, onLaunchStatusChange() {}, onCancel() {}, onConfirm() {}, onReturnHome() {},
  }));
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}${css}
    </style></head><body>${markup}</body></html>`;
}

async function assertWithinViewport(locator, viewport, label) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds, `${label}: élément absent`);
  assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, `${label}: débordement horizontal`);
  assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1, `${label}: débordement vertical`);
}

test("la vraie confirmation Google complète tient sans scroll sur desktop standard et grand écran", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[768, 1024], [1024, 768], [1366, 768], [1440, 900], [1707, 842], [2560, 1528]]) {
      const viewport = { width, height };
      const page = await browser.newPage({ viewport });
      try {
        await page.setContent(fixture({ channel: "Pinterest Ads" }));
        const label = `${width}×${height}`;
        await assertWithinViewport(page.getByRole("dialog", { name: "Lancer cette campagne ?" }), viewport, label);
        assert.equal(await page.getByRole("radio").count(), 2, `${label}: les deux choix de statut doivent être testés`);
        assert.equal(await page.getByRole("checkbox").count(), 1, `${label}: déclaration finale absente du test`);
        const layout = await page.evaluate(() => ({
          documentOverflows: document.documentElement.scrollWidth > innerWidth,
          scrollable: [...document.querySelectorAll(".dialog,.content")].filter((element) => element.scrollHeight > element.clientHeight + 1).map((element) => element.className),
        }));
        assert.equal(layout.documentOverflows, false, `${label}: défilement horizontal`);
        assert.deepEqual(layout.scrollable, [], `${label}: la confirmation standard défile encore`);
        await assertWithinViewport(page.getByRole("button", { name: "Confirmer et lancer", exact: true }), viewport, `${label}: validation sans défilement`);
        await assertWithinViewport(page.getByRole("button", { name: "Annuler", exact: true }), viewport, `${label}: annulation sans défilement`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("la vraie modale garde le footer visible et son contenu accessible sur petit mobile", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[280, 568], [320, 568], [375, 667]]) {
      const viewport = { width, height };
      const page = await browser.newPage({ viewport });
      try {
        await page.setContent(fixture({ launchStatus: "paused" }));
        const label = `${width}×${height}`;
        await assertWithinViewport(page.getByRole("dialog", { name: "Lancer cette campagne ?" }), viewport, label);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: défilement horizontal`);
        const confirm = page.getByRole("button", { name: "Confirmer en pause", exact: true });
        await assertWithinViewport(confirm, viewport, `${label}: footer initial`);
        for (const control of [page.getByRole("radio").first(), page.getByRole("radio").last(), page.getByRole("checkbox")]) {
          await control.scrollIntoViewIfNeeded();
          await assertWithinViewport(control, viewport, `${label}: contrôle accessible`);
          const unobscured = await control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const topmost = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            return element === topmost || element.contains(topmost);
          });
          assert.equal(unobscured, true, `${label}: contrôle caché sous le footer`);
          await assertWithinViewport(confirm, viewport, `${label}: footer après défilement`);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("le retour au cockpit reste accessible après une création active ou en pause", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const launchStatus of ["active", "paused"]) {
      const viewport = { width: 320, height: 568 };
      const page = await browser.newPage({ viewport });
      try {
        await page.setContent(fixture({ mode: "success", launchStatus }));
        await assertWithinViewport(page.getByRole("dialog"), viewport, `Succès ${launchStatus}`);
        await assertWithinViewport(page.getByRole("button", { name: /Retour à l’accueil/ }), viewport, `Retour ${launchStatus}`);
        assert.match(await page.getByRole("button", { name: /Retour à l’accueil/ }).innerText(), /100\s*%/);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
