import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { fixture, html } from "./personalization-browser-fixture.mts";

test("personalization displays the weighted total and subsection scores without rating optional writing instructions", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
    await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
    await page.evaluate(() => {
      (window as unknown as { fixturePreparationScores: Record<string, unknown> }).fixturePreparationScores = {
        companyScore: 100, ctaScore: 0, strategyScore: 83, personalizationScore: 83, scoresKnown: true,
      };
      (window as unknown as { fixtureMemoryReadOverride: Record<string, unknown> }).fixtureMemoryReadOverride = { campaignCalendar: "" };
    });
    await page.addScriptTag({ content: fixture });
    await page.locator("[data-business-dna-channel-analysis]").waitFor();
    const total = page.locator("[data-dashboard-workspace-status]");
    assert.equal(await total.innerText(), "83%", "the header consumes the approved weighted score rather than the legacy average");
    const breakdown = await total.getAttribute("title");
    assert.match(breakdown || "", /Mon entreprise \(75 %\) : 100%/);
    assert.match(breakdown || "", /CTA par canal \(15 %\) : 0%/);
    assert.match(breakdown || "", /Objectifs et stratégie \(10 %\) : 83%/);
    const primary = page.locator("[data-dashboard-workspace-navigation]");
    await primary.getByRole("button", { name: "Mon entreprise", exact: true }).click();
    await page.getByRole("navigation", { name: "Mon entreprise", exact: true }).getByRole("button", { name: "Clients", exact: true }).click();
    await page.locator('[data-ai-memory-tab="audience"]').waitFor();
    assert.equal(await page.locator('[data-ai-memory-tab="audience"] [aria-label="Clients : 100%"] strong').innerText(), "100%");
    await page.getByRole("navigation", { name: "Mon entreprise", exact: true }).getByRole("button", { name: "Identité", exact: true }).click();
    assert.equal(await page.locator('[data-ai-memory-tab="identity"] [aria-label="Identité : 100%"] strong').innerText(), "100%");
    await primary.getByRole("button", { name: "Ma communication", exact: true }).click();
    await page.getByRole("navigation", { name: "Ma communication", exact: true }).getByRole("button", { name: "Objectifs et stratégie", exact: true }).click();
    await page.locator('[data-ai-memory-tab="strategy"]').waitFor();
    assert.equal(await page.locator('[data-ai-memory-tab="strategy"] [aria-label="Stratégie : 83%"] strong').innerText(), "83%");
    await page.getByRole("navigation", { name: "Ma communication", exact: true }).getByRole("button", { name: "Consignes et exemples", exact: true }).click();
    await page.locator('[data-ai-section="instructions"]').waitFor();
    assert.equal(await page.locator('[data-ai-section="instructions"] [aria-label*="%"], [data-ai-section="instructions"] [role="progressbar"]').count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  } finally { await browser.close(); }
});


test("profile save refreshes the company scoring context without replacing an existing memory draft", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
    await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
    await page.addScriptTag({ content: fixture });
    await page.locator("[data-business-dna-channel-analysis]").waitFor();
    const companyScore = page.locator("[data-dna-score-summary]");
    assert.equal(await companyScore.innerText(), "80%");
    await page.evaluate(() => {
      const state = window as unknown as {
        fixtureCompletionContext: Record<string, unknown>;
        fixtureMemoryReadOverride: Record<string, unknown>;
      };
      state.fixtureCompletionContext = { companyName: "" };
      state.fixtureMemoryReadOverride = { mission: "Unexpected background memory must not replace the local editor." };
      window.dispatchEvent(new CustomEvent("inrcy:public-profile-data-saved"));
    });
    await page.waitForFunction(() => document.querySelector("[data-dna-score-summary]")?.textContent === "77%");
    await page.locator("[data-dashboard-workspace-navigation]").getByRole("button", { name: "Mon entreprise", exact: true }).click();
    await page.getByRole("navigation", { name: "Mon entreprise", exact: true }).getByRole("button", { name: "Identité", exact: true }).click();
    assert.equal(await page.locator("#business-dna-mission").innerText(), "Rendre les projets de nos clients plus simples et plus efficaces.");
    assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

