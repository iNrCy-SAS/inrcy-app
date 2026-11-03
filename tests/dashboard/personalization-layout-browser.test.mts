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

test("eight and ten analysis documents scroll inside their card while channels and document metadata stay fixed", { timeout: 60_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      for (const count of [8, 10]) {
        const page = await browser.newPage({ viewport });
        const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", route => {
          if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: html });
          const asset = path.resolve(ROOT, "public", `.${new URL(route.request().url()).pathname}`);
          if (asset.startsWith(path.resolve(ROOT, "public") + path.sep) && existsSync(asset)) return route.fulfill({ contentType: asset.endsWith(".svg") ? "image/svg+xml" : "image/png", body: readFileSync(asset) });
          return route.abort();
        });
        await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
        await page.evaluate(value => { (window as unknown as { fixtureDocumentCount: number }).fixtureDocumentCount = value; }, count);
        await page.addScriptTag({ content: fixture });
        const list = page.locator("[data-reference-document-list]");
        await list.waitFor();
        const documents = page.locator("[data-analysis-documents]");
        const rows = list.locator("[data-reference-document]");
        await rows.nth(count - 1).waitFor();
        await page.waitForTimeout(300);
        assert.equal(await rows.count(), count);
        assert.match(await documents.locator("[data-reference-document-count]").innerText(), new RegExp(`${count}/10`));
        const measure = () => page.evaluate(() => {
          const rect = (selector: string) => {
            const bounds = document.querySelector(selector)!.getBoundingClientRect();
            return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, height: bounds.height };
          };
          const list = document.querySelector<HTMLElement>("[data-reference-document-list]")!;
          return {
            header: rect("[data-dashboard-workspace-header]"), channels: rect("[data-analysis-channel-panel]"),
            card: rect('[data-ai-memory-tab="documents"]'), title: rect('[data-ai-memory-tab="documents"] [data-memory-section-heading]'),
            storage: rect("[data-document-storage]"), list: rect("[data-reference-document-list]"), footer: rect("[data-analysis-action-group]"),
            listHeight: list.clientHeight, listContentHeight: list.scrollHeight, listScrollTop: list.scrollTop,
            listOverflow: getComputedStyle(list).overflowY, columnScrollTop: document.querySelector("[data-analysis-source-panels]")!.scrollTop,
            pageScrollTop: window.scrollY, pageHeight: document.documentElement.scrollHeight,
            horizontal: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        const before = await measure();
        assert.equal(before.horizontal, false, `${count} documents: no horizontal overflow at ${viewport.width}px`);
        assert.ok(before.listHeight > 50, "the document list has usable space");
        assert.ok(before.listContentHeight > before.listHeight + 1, "the populated list has its own scrollable overflow");
        assert.equal(before.listOverflow, "auto");
        assert.ok(before.list.left >= before.card.left && before.list.right <= before.card.right, "document rows fit inside the card width");
        assert.ok(before.list.top >= before.storage.bottom && before.list.bottom < before.card.bottom, "the list stays below fixed storage and above the card border");
        if (viewport.width >= 1366) {
          assert.ok(before.pageHeight <= viewport.height + 2, "populated documents do not create desktop page scrolling");
          assert.ok(before.channels.top >= before.header.bottom && before.channels.bottom <= before.card.top, "the channels remain completely visible above documents");
          assert.ok(before.card.bottom <= viewport.height && before.footer.bottom <= viewport.height, "documents and actions fit the desktop viewport");
        } else {
          assert.ok(before.listHeight <= 300, "mobile document scrolling remains bounded");
        }
        await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
        const lastButton = rows.last().getByRole("button");
        assert.equal(await lastButton.isEnabled(), true, "the final document can still be deleted");
        const lastBounds = await lastButton.boundingBox();
        const after = await measure();
        assert.ok(lastBounds && lastBounds.y >= after.list.top && lastBounds.y + lastBounds.height <= after.list.bottom, "the final document action is inside the list after scrolling");
        assert.ok(after.listScrollTop > 0);
        for (const key of ["header", "channels", "title", "storage", "footer"] as const) assert.deepEqual(after[key], before[key], `${key} remains fixed while files scroll`);
        assert.equal(after.columnScrollTop, 0, "the entire source column never scrolls");
        assert.equal(after.pageScrollTop, before.pageScrollTop, "list scrolling never moves the page");
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0, "rendering and scrolling existing documents never writes data");
        if (process.env.INRCY_PERSONALIZATION_PROOF) {
          mkdirSync(process.env.INRCY_PERSONALIZATION_PROOF, { recursive: true });
          await page.screenshot({ path: path.join(process.env.INRCY_PERSONALIZATION_PROOF, `analysis-${count}-documents-${viewport.width}.png`), fullPage: true, animations: "disabled", timeout: 10_000 });
        }
        t.diagnostic(JSON.stringify({ viewport, count, listHeight: after.listHeight, contentHeight: after.listContentHeight, pageHeight: after.pageHeight }));
        await page.close();
      }
    }
  } finally { await browser.close(); }
});

test("populated tag groups and long strategy text remain contained and reachable at all responsive sizes", { timeout: 90_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  const violations: string[] = [];
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: html });
        const asset = path.resolve(ROOT, "public", `.${new URL(route.request().url()).pathname}`);
        if (asset.startsWith(path.resolve(ROOT, "public") + path.sep) && existsSync(asset)) return route.fulfill({ contentType: asset.endsWith(".svg") ? "image/svg+xml" : "image/png", body: readFileSync(asset) });
        return route.abort();
      });
      await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
      await page.evaluate(() => { (window as unknown as { fixtureStressContent: boolean }).fixtureStressContent = true; });
      await page.addScriptTag({ content: fixture });
      await page.locator("[data-business-dna-channel-analysis]").waitFor();
      const primary = page.locator("[data-dashboard-workspace-navigation]");
      const check = async (name: string, selector: string, expectedTagCounts: number[]) => {
        const panel = page.locator(selector);
        await panel.waitFor();
        await page.waitForTimeout(80);
        const groups = panel.locator("[data-editable-tags]");
        assert.equal(await groups.count(), expectedTagCounts.length, `${name}: expected populated tag groups are rendered`);
        for (let index = 0; index < expectedTagCounts.length; index++) {
          const group = groups.nth(index);
          const list = group.locator("[data-editable-tags-list]");
          assert.equal(await list.count(), 1, `${name}: the tag list has its own bounded scrolling region`);
          const tags = list.locator("[data-editable-tag]");
          assert.equal(await tags.count(), expectedTagCounts[index], `${name}: every saved tag is preserved`);
          const dimensions = await list.evaluate(node => {
            const list = node as HTMLElement, box = list.getBoundingClientRect(), group = list.parentElement!.getBoundingClientRect();
            return { height: list.clientHeight, content: list.scrollHeight, left: box.left, right: box.right, top: box.top, bottom: box.bottom, groupBottom: group.bottom, overflow: getComputedStyle(list).overflowY };
          });
          if (dimensions.height <= 0 || dimensions.height > 320) violations.push(`${viewport.width}/${name}/${index}: tag-list height ${dimensions.height}`);
          if (dimensions.bottom > dimensions.groupBottom + 1) violations.push(`${viewport.width}/${name}/${index}: tags escape their editor`);
          if (dimensions.left < -1 || dimensions.right > viewport.width + 1) violations.push(`${viewport.width}/${name}/${index}: tags overflow horizontally`);
          if (dimensions.content > dimensions.height + 1 && !["auto", "scroll"].includes(dimensions.overflow)) violations.push(`${viewport.width}/${name}/${index}: overflowing tags cannot scroll`);
          await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
          const last = await tags.last().getByRole("button").boundingBox();
          const listBounds = await list.boundingBox();
          if (!last || !listBounds || last.y < listBounds.y - 1 || last.y + last.height > listBounds.y + listBounds.height + 1) violations.push(`${viewport.width}/${name}/${index}: final remove action is unreachable`);
        }
        const measurement = await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth > innerWidth + 1, pageHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight }));
        if (measurement.horizontal) violations.push(`${viewport.width}/${name}: horizontal page overflow`);
        if (viewport.width >= 1366 && measurement.pageHeight > viewport.height + 2) violations.push(`${viewport.width}/${name}: page height ${measurement.pageHeight}/${viewport.height}`);
        if (process.env.INRCY_PERSONALIZATION_PROOF) {
          mkdirSync(process.env.INRCY_PERSONALIZATION_PROOF, { recursive: true });
          await page.screenshot({ path: path.join(process.env.INRCY_PERSONALIZATION_PROOF, `stress-${name}-${viewport.width}.png`), fullPage: true, animations: "disabled", timeout: 10_000 });
        }
        t.diagnostic(JSON.stringify({ viewport, name, ...measurement }));
      };
      await primary.getByRole("button", { name: "Mon entreprise", exact: true }).click();
      const company = page.getByRole("navigation", { name: "Mon entreprise", exact: true });
      for (const [name, label, selector, counts] of [
        ["activity", "Activité", '[data-ai-memory-active-tab="activity"]', [20, 16]],
        ["audience", "Clients", '[data-ai-memory-tab="audience"]', [16, 16]],
        ["local", "Zones", '[data-ai-memory-tab="local"]', [30]],
        ["identity", "Identité", '[data-ai-memory-tab="identity"]', [16, 16, 12, 12]],
      ] as const) {
        await company.getByRole("button", { name: label, exact: true }).click();
        await check(name, selector, [...counts]);
      }
      await primary.getByRole("button", { name: "Ma communication", exact: true }).click();
      const communication = page.getByRole("navigation", { name: "Ma communication", exact: true });
      await communication.getByRole("button", { name: "Consignes et exemples", exact: true }).click();
      await check("vocabulary", '[data-ai-section="instructions"]', [16, 16]);
      await communication.getByRole("button", { name: "Objectifs et stratégie", exact: true }).click();
      await check("strategy", '[data-ai-memory-tab="strategy"]', []);
      const editors = page.locator('[data-ai-memory-tab="strategy"] [role="textbox"]');
      assert.equal(await editors.count(), 6);
      for (let index = 0; index < 6; index++) {
        const editor = editors.nth(index);
        assert.ok((await editor.innerText()).length > 2500, "the strategy test uses saved long text rather than empty placeholders");
        const dimensions = await editor.evaluate(node => {
          const editor = node as HTMLElement;
          editor.scrollTop = editor.scrollHeight;
          return { height: editor.clientHeight, content: editor.scrollHeight, scrollTop: editor.scrollTop, overflow: getComputedStyle(editor).overflowY };
        });
        if (dimensions.height < (viewport.width >= 1600 ? 140 : 100)) violations.push(`${viewport.width}/strategy/${index}: editor height ${dimensions.height} wastes available space`);
        if (!(["auto", "scroll"].includes(dimensions.overflow) && dimensions.scrollTop > 0)) violations.push(`${viewport.width}/strategy/${index}: long text cannot scroll locally`);
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0, "reading full saved content never writes data");
      await page.close();
    }
    assert.deepEqual(violations, []);
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
