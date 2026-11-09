import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, webkit } from "@playwright/test";
import ts from "typescript";
import * as workspacePolicy from "../../lib/inrAgentWorkspaces.ts";
import * as editionPolicy from "../../lib/dashboardEdition.ts";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const css = read("app/dashboard/_components/DashboardSignatureTools.module.css") +
  read("app/dashboard/_components/DashboardAgentLogoButton.module.css").replace(/\.([a-zA-Z_][\w-]*)/g, ".agent-$1");
const compiled = new Map<string, string>();
for (const name of ["DashboardModulesCard", "DashboardAgentLogoButton", "DashboardPremiumLockIcon", "DashboardToolArtwork", "StudioIcon", "BoosterIcon"]) {
  compiled.set(name, ts.transpileModule(read(`app/dashboard/_components/${name}.tsx`), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
}
type Props = Record<string, unknown>;

/** Real tool/agent markup and styles; only routing, entitlement and account hooks are isolated. */
function markup(locale: string, standard: boolean) {
  const messages = Object.fromEntries(["dashboard", "shell", "agent"].map(name => [name, JSON.parse(read(`messages/${locale}/${name}.json`))]));
  const cache = new Map<string, { exports: { default?: ComponentType<Props> } }>();
  const noOp = () => {};
  function load(name: string) {
    if (cache.has(name)) return cache.get(name)!.exports;
    assert.ok(compiled.has(name), `Unexpected tool component ${name}`);
    const record: { exports: { default?: ComponentType<Props> } } = { exports: {} };
    cache.set(name, record);
    new Function("module", "exports", "require", compiled.get(name)!)(record, record.exports, (id: string): unknown => {
      if (id === "react" || id === "react/jsx-runtime") return require(id);
      if (id.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => (id.includes("DashboardAgentLogoButton") ? "agent-" : "") + String(key) }) };
      if (id === "next/image") return { __esModule: true, default: ({ src, alt, className, width, height }: Props) => createElement("img", { src, alt, className, width, height }) };
      if (id === "next/dynamic") return { __esModule: true, default: () => () => null };
      if (id === "next/navigation") return { usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: noOp }) };
      if (id === "next-intl") return { useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Props)[part] : undefined, messages) };
      if (id === "../_hooks/useDashboardI18n") return { useDashboardI18n: () => ({ ...messages.dashboard, locale }) };
      if (id === "../_hooks/useInrAgentPendingCount") return { useInrAgentPendingCount: () => 0 };
      if (id === "./DashboardEditionProvider") return { useDashboardEdition: () => standard ? "standard" : "premium", useDashboardSubscriptionEdition: () => standard ? "standard" : "premium" };
      if (id === "./DashboardToolWarmup") return { requestDashboardToolWarmup: noOp };
      if (id === "@/hooks/useDelayedPendingAction") return { useDelayedPendingAction: () => ({ pendingKey: null, beginAction: () => true, completeAction: noOp, isVisible: () => false }) };
      if (id === "@/lib/inrAgentWorkspaces") return workspacePolicy;
      if (id === "@/lib/dashboardEdition") return editionPolicy;
      if (id === "../dashboard.scroll") return { DASHBOARD_GEARBOX_ANCHOR_ID: "gearbox" };
      if (id === "./WorkflowBaseModal" || id === "./AdsChannelInfoModal") return { __esModule: true, default: () => null };
      return load(id.replace(/^\.\//, ""));
    });
    return record.exports;
  }
  return renderToStaticMarkup(createElement(load("DashboardModulesCard").default!, { goToModule: noOp, openPanel: noOp, standardMode: standard,
    overview: { leadsWeek: 125, leadsMonth: 689, oppTotal: 286, estimatedValue: 5720 },
  }));
}

test("Campaigns mail keeps its artwork and agent clear of both touch actions on narrow phones", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ["fr-FR", "de-DE", "en-GB", "it-IT", "es-ES", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
      for (const standard of [false, true]) {
        const page = await browser.newPage();
        await page.route("**/*", route => route.abort());
        await page.setContent(`<html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:10px;background:#09132e;color:white;font:14px Arial}button{font-family:inherit}${css}</style></head><body>${markup(locale, standard)}</body></html>`);
        const card = page.locator(".campaignCard");
        for (const width of [320, 360, 375, 390]) {
          await page.setViewportSize({ width, height: 800 });
          const bounds = await card.evaluate(root => {
            const rect = (selector: string) => { const e = root.querySelector(selector)!; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
            const b = root.getBoundingClientRect();
            return { card: { x: b.x, y: b.y, right: b.right, bottom: b.bottom }, manual: rect(".manualToolActions > button"), pilot: rect("[data-agent-workspace=campaigns]"), robot: rect(".compactCampaignAgent img"), art: rect(".pilotArtwork"), description: rect(".signatureCopy"), overflow: root.scrollWidth > root.clientWidth + 1 };
          });
          const context = `${locale}, ${standard ? "locked" : "premium"}, ${width}px`;
          for (const [name, rect] of Object.entries({ manual: bounds.manual, pilot: bounds.pilot, robot: bounds.robot, art: bounds.art })) {
            assert.ok(rect.x >= bounds.card.x && rect.right <= bounds.card.right + 1 && rect.y >= bounds.card.y && rect.bottom <= bounds.card.bottom + 1, `${context}: ${name} stays inside its card`);
          }
          for (const button of [bounds.manual, bounds.pilot]) {
            for (const decoration of [bounds.robot, bounds.art]) assert.ok(decoration.bottom <= button.y - 7 || decoration.right <= button.x - 7 || decoration.x >= button.right + 7, `${context}: decoration cannot cover an action`);
            assert.ok(button.height >= 44 && button.width >= 80, `${context}: both actions remain touch sized`);
          }
          assert.ok(bounds.manual.right <= bounds.pilot.x - 7, `${context}: actions keep an independent gap`);
          assert.ok(bounds.art.bottom <= bounds.manual.y - 7, `${context}: the envelopes sit above Choose`);
          assert.ok(bounds.robot.bottom <= bounds.pilot.y - 7, `${context}: the mascot sits above Pilot`);
          assert.ok(Math.min(bounds.art.y, bounds.robot.y) >= bounds.description.bottom + 7, `${context}: the decorations leave the description clear`);
          assert.ok(bounds.manual.x <= bounds.card.x + 20, `${context}: Choose starts at the left content edge`);
          assert.equal(bounds.overflow, false, `${context}: no clipped horizontal content`);
        }
        await page.close();
      }
    }
    t.diagnostic("72 layouts: 9 languages × Premium/locked × 320/360/375/390px; real TSX and CSS, no account or provider calls.");
  } finally { await browser.close(); }
});

test("the dashboard tool cards keep their actions visible in touch WebKit tablet layouts", async t => {
  const browser = await webkit.launch({ headless: true });
  try {
    for (const locale of ["fr-FR", "de-DE"]) {
      const page = await browser.newPage({ isMobile: true, hasTouch: true });
      await page.route("**/*", route => route.abort());
      await page.setContent(`<html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:10px;background:#09132e;color:white;font:14px Arial}button{font-family:inherit}${css}</style></head><body>${markup(locale, false)}</body></html>`);
      for (const viewport of [{ width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 834, height: 1194 }, { width: 1024, height: 768 }]) {
        await page.setViewportSize(viewport);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale}, ${viewport.width}px: the dashboard has no horizontal page scroll`);
        const cards = await page.locator(".signatureCard, .boosterCard").evaluateAll(elements => elements.map(root => {
          const rectangle = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
          const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
          return { title: root.querySelector("h4")?.textContent, bounds: rectangle(root), buttons: [...root.querySelectorAll("button")].filter(visible).map(e => ({ ...rectangle(e), label: e.getAttribute("aria-label") || e.textContent })), decorations: [...root.querySelectorAll(".pilotArtwork, .agent-contextualRobot")].filter(visible).map(rectangle) };
        }));
        const overlaps = (a: { x: number; y: number; right: number; bottom: number }, b: { x: number; y: number; right: number; bottom: number }) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
        for (const card of cards) {
          const context = `${locale}, ${viewport.width}×${viewport.height}, ${card.title}`;
          assert.ok(card.bounds.x >= 0 && card.bounds.right <= viewport.width + 1, `${context}: card stays inside the viewport`);
          for (const [index, button] of card.buttons.entries()) {
            assert.ok(button.x >= card.bounds.x && button.right <= card.bounds.right + 1 && button.y >= card.bounds.y && button.bottom <= card.bounds.bottom + 1, `${context}: ${button.label} stays inside its card`);
            for (const other of card.buttons.slice(index + 1)) assert.equal(overlaps(button, other), false, `${context}: actions ${button.label} / ${other.label} cannot overlap`);
            for (const decoration of card.decorations) assert.equal(overlaps(button, decoration), false, `${context}: artwork cannot cover ${button.label}`);
          }
        }
      }
      await page.close();
    }
    t.diagnostic("8 touch WebKit layouts: French/German, iPad portrait 768/820/834 and landscape 1024; actual dashboard tool and agent markup.");
  } finally { await browser.close(); }
});
