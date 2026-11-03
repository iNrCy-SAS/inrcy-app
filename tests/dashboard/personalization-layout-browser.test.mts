import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { ROOT, fixture, html } from "./personalization-browser-fixture.mts";

test("all personalization tabs keep fields accessible and fit the desktop workspace without horizontal overflow", { timeout: 90_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: html });
        const asset = path.resolve(ROOT, "public", `.${url.pathname}`);
        if (asset.startsWith(path.resolve(ROOT, "public") + path.sep) && existsSync(asset)) return route.fulfill({ contentType: url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png", body: readFileSync(asset) });
        return route.abort();
      });
      await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
      await page.addScriptTag({ content: fixture });
      await page.locator("[data-business-dna-channel-analysis]").waitFor();
      const primary = page.locator("[data-dashboard-workspace-navigation]");
      assert.equal(await primary.getByRole("button").count(), 3);
      const measurements: Array<Record<string, unknown>> = [];
      const check = async (name: string) => {
        await page.waitForTimeout(80);
        const measurement = await page.evaluate(() => {
          const controls = [...document.querySelectorAll("main input:not([type=file]),main textarea, main select, main [contenteditable]")].filter(node => (node as HTMLElement).getClientRects().length);
          return {
            horizontal: document.documentElement.scrollWidth > innerWidth + 1,
            pageHeight: document.documentElement.scrollHeight, viewport: innerHeight, controls: controls.length,
            controlBoundsValid: controls.every(node => {const r = node.getBoundingClientRect();return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1;}),
            hiddenPanelsVisible: [...document.querySelectorAll('[hidden]')].filter(node => node.getClientRects().length > 0).map(node => node.getAttribute('data-ai-memory-tab') || node.id || node.tagName),
            grids: [...document.querySelectorAll('[data-identity-core],[data-ai-memory-news-rows],[data-ai-memory-premium-rows]')].filter(node => node.getClientRects().length).map(node => ({name:node.getAttributeNames().find(name=>name.startsWith('data-')),columns:getComputedStyle(node).gridTemplateColumns})),
          };
        });
        assert.equal(measurement.horizontal, false, `${name}: no horizontal page overflow at ${viewport.width}px`);
        assert.equal(measurement.controlBoundsValid, true, `${name}: fields fit the available width`);
        assert.deepEqual(measurement.hiddenPanelsVisible, [], `${name}: inactive tabs stay hidden after being mounted`);
        if (viewport.width >= 1366) assert.ok(measurement.pageHeight <= viewport.height + 2, `${name}: normal populated content fits desktop height (${measurement.pageHeight}/${viewport.height})`);
        measurements.push({ name, ...measurement });
        if (process.env.INRCY_PERSONALIZATION_PROOF && viewport.width !== 390) {
          mkdirSync(process.env.INRCY_PERSONALIZATION_PROOF, { recursive: true });
          await page.screenshot({ path: path.join(process.env.INRCY_PERSONALIZATION_PROOF, `${name}-${viewport.width}.png`), fullPage: true });
        }
      };
      await check("analysis");
      assert.equal(await page.getByRole("button", { name: "Ajouter des documents", exact: true }).count(), 1, "one attachment action: the paperclip");
      const fileChooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Ajouter des documents", exact: true }).click();
      await (await fileChooser).setFiles({ name: "reference.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% isolated consent test") });
      await page.waitForFunction(() => (window as unknown as { confirmations: unknown[] }).confirmations.length === 1);
      assert.equal(await page.evaluate(() => (window as unknown as { confirmations: { title: string }[] }).confirmations[0].title), "J’autorise l’analyse de ces documents par iNrCy");
      assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0, "declining consent never starts a document upload");
      await primary.getByRole("button", { name: "Mon entreprise", exact: true }).click();
      const subnav = page.getByRole("navigation", { name: "Mon entreprise", exact: true });
      for (const [name, label, selector] of [
        ["profile", "Coordonnées & logo", "[data-profile-form-grid] input"],
        ["activity", "Activité", "[data-activity-section=identity] input"],
        ["audience", "Clients", "[data-ai-memory-tab=audience]"],
        ["local", "Zones", "[data-business-location] input"],
        ["identity", "Identité", "#business-dna-mission"],
      ]) {
        await subnav.getByRole("button", { name: label, exact: true }).click();
        await page.locator(selector).first().waitFor(); await check(name);
        if (name === "activity" && viewport.width >= 1000) {
          const bounds = await page.locator('[data-ai-memory-active-tab="activity"]').evaluate(node => {
            const box=(selector:string)=>{const rect=node.querySelector(selector)!.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width}};
            return {foundation:box('[data-ai-memory-tab="activity-foundation"]'),description:box('[data-memory-field="description"]'),services:box('[data-activity-services]'),columns:getComputedStyle(node).gridTemplateColumns.split(' ').length};
          });
          assert.equal(bounds.columns, 2, "Activity uses exactly two desktop columns");
          assert.ok(Math.abs(bounds.foundation.left-bounds.description.left) < 1);
          assert.ok(Math.abs(bounds.foundation.width-bounds.description.width) < 1);
          assert.ok(bounds.description.top >= bounds.foundation.bottom+8, "Presentation sits below profession in the same left column");
          assert.ok(bounds.services.left >= bounds.description.right+8, "Services and specialties share the right column");
        }
        if (name === "identity") {
          assert.equal(await page.locator("#business-dna-mission").getAttribute("role"), "textbox");
          assert.equal(await page.locator('[data-ai-memory-tab="identity"] [data-personalization-vocabulary]').count(), 0, "brand vocabulary belongs to communication instructions");
        }
      }
      assert.equal(await subnav.getByRole("button", { name: "Actualités", exact: true }).count(), 0);
      await primary.getByRole("button", { name: "Ma communication", exact: true }).click();
      const commNav = page.getByRole("navigation", { name: "Ma communication", exact: true });
      for (const [name, label, selector] of [
        ["parameters", "Style et préférences", "[data-ai-section=foundation]"],
        ["instructions", "Consignes et exemples", "[data-ai-section=instructions]"],
        ["ctas", "CTA par canal", "[data-ai-section=channel-ctas]"],
        ["strategy", "Objectifs et stratégie", "[data-ai-memory-tab=strategy]"],
        ["news", "Actualités", "[data-ai-memory-tab=news]"],
      ]) {
        await commNav.getByRole("button", { name: label, exact: true }).click();
        await page.locator(selector).first().waitFor(); await check(name);
        if (name === "instructions") {
          const order = await page.locator('[data-ai-section="instructions"]').evaluate(node => {
            const fields=node.querySelector('[data-custom-instructions]'),vocabulary=node.querySelector('[data-personalization-vocabulary]'),examples=node.querySelector('[data-instruction-examples]');
            return !!fields&&!!vocabulary&&!!examples&&!!(fields.compareDocumentPosition(vocabulary)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(vocabulary.compareDocumentPosition(examples)&Node.DOCUMENT_POSITION_FOLLOWING);
          });
          assert.equal(order, true, "vocabulary appears after instructions and before liked examples");
          assert.equal(await page.getByText("Mots et expressions à privilégier", { exact: true }).count(), 1, "one canonical vocabulary editor is mounted through the portal");
        }
        if (name === "strategy") {
          const strategy = page.locator("[data-ai-memory-tab=strategy]");
          assert.equal(await strategy.getByRole("textbox").count(), 6, "all six strategy fields use the same rich editor");
          assert.equal(await strategy.getByRole("button", { name: "Gras", exact: true }).count(), 6);
          assert.equal(await strategy.getByRole("button", { name: "Liste à puces", exact: true }).count(), 6);
        }
        if (name === "ctas") {
          const trigger = page.getByRole("button", { name: "Action à proposer", exact: true });
          await trigger.focus(); await page.keyboard.press("ArrowDown");
          const list = page.getByRole("listbox", { name: "Action à proposer", exact: true });
          await list.waitFor();
          assert.equal(await list.locator('[aria-selected="true"]').evaluate(node => node === document.activeElement), true, "CTA menu starts on the current choice");
          await page.keyboard.press("End");
          assert.equal(await list.getByRole("option").last().evaluate(node => node === document.activeElement), true);
          await page.keyboard.press("Home");
          assert.equal(await list.getByRole("option").first().evaluate(node => node === document.activeElement), true);
          const bounds = await list.boundingBox();
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, "CTA choices stay inside the viewport");
          await page.keyboard.press("Escape");
          await list.waitFor({ state: "hidden" });
          assert.equal(await trigger.evaluate(node => node === document.activeElement), true, "closing the CTA menu returns keyboard focus to its trigger");
          const channel = await page.locator("[data-cta-channel]").getAttribute("data-cta-channel");
          await page.getByRole("button", { name: "Canal suivant", exact: true }).click();
          await page.waitForFunction(previous => document.querySelector("[data-cta-channel]")?.getAttribute("data-cta-channel") !== previous, channel);
        }
      }
      await primary.getByRole("button", { name: "Mon entreprise", exact: true }).click();
      await primary.getByRole("button", { name: "Ma communication", exact: true }).click();
      await page.locator("[data-ai-memory-tab=news]").waitFor({ state: "visible" });
      assert.equal(await page.locator("[data-ai-memory-tab=news]").isVisible(), true, "returning to communication restores its selected memory tab");
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0, "tab navigation and hydration do not write data");
      t.diagnostic(JSON.stringify({ viewport, measurements })); await page.close();
    }
  } finally { await browser.close(); }
});

test("rich strategy formatting survives a controlled remount without any network write", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
    await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
    await page.addScriptTag({ content: fixture });
    await page.locator("[data-business-dna-channel-analysis]").waitFor();
    await page.evaluate(() => (window as unknown as { renderRichEditor: () => void }).renderRichEditor());
    const editor = page.getByRole("textbox", { name: "Argument de test", exact: true });
    await editor.fill("Argument clair");
    await editor.press("Control+A");
    await page.getByRole("button", { name: "Gras", exact: true }).click();
    await page.waitForFunction(() => /<(?:strong|b)>/.test((window as unknown as { richDraft: { html: string } }).richDraft.html));
    await editor.focus(); await editor.press("Control+A");
    await page.getByRole("button", { name: "Liste à puces", exact: true }).click();
    await page.waitForFunction(() => /<ul>[\s\S]*<li>/.test((window as unknown as { richDraft: { html: string } }).richDraft.html));
    const saved = await page.evaluate(() => (window as unknown as { richDraft: { text: string; html: string } }).richDraft);
    assert.equal(saved.text.trim(), "• Argument clair", "the plain-text version retains the list bullet for prompts");
    await page.evaluate(() => (window as unknown as { remountRichEditor: () => void }).remountRichEditor());
    await page.waitForTimeout(80);
    assert.equal(await editor.innerHTML(), saved.html, "the saved rich HTML is restored on remount");
    assert.equal(await editor.innerText(), "Argument clair");
    assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
