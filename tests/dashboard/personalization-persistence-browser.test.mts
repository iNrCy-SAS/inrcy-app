import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import { fixture, html } from "./personalization-browser-fixture.mts";

type Write = { kind: string; payload: Record<string, unknown>; resolved: boolean };
type FixtureWindow = Window & {
  allowWrites: boolean;
  holdWrites: boolean;
  holdAuth: boolean;
  activeAccount: string;
  fixtureWrites: Write[];
  authWaiters: unknown[];
  navigationCalls: string[];
  releaseFixtureWrite: (index: number) => void;
  releaseFixtureAuth: (index: number) => void;
};

async function setup(page: Page) {
  page.setDefaultTimeout(7_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
  await page.addScriptTag({ content: fixture });
  await page.locator("[data-business-dna-channel-analysis]").waitFor();
  await page.locator("[data-dashboard-workspace-navigation]").getByRole("button", { name: "Mon entreprise", exact: true }).click();
  await page.locator('[data-profile-form-grid] input[autocomplete="organization"]').waitFor();
  return errors;
}
async function waitForWrite(page: Page, kind: string, count: number) {
  await page.waitForFunction(({ kind, count }) => (window as unknown as FixtureWindow).fixtureWrites.filter(write => write.kind === kind).length >= count, { kind, count }, { timeout: 7_000 });
}
async function releaseWrite(page: Page, kind: string, index: number) {
  await page.evaluate(({ kind, index }) => {
    const state = window as unknown as FixtureWindow;
    const matching = state.fixtureWrites.map((write, position) => ({ write, position })).filter(item => item.write.kind === kind);
    state.releaseFixtureWrite(matching[index].position);
  }, { kind, index });
}

test("a tag edited during an ADN save is retained and flushed before leaving", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = await setup(page);
    await page.getByRole("navigation", { name: "Mon entreprise", exact: true }).getByRole("button", { name: "Clients", exact: true }).click();
    const audience = page.locator('[data-ai-memory-tab="audience"]');
    await audience.waitFor();
    await page.evaluate(() => {const state=window as unknown as FixtureWindow;state.allowWrites=true;state.holdWrites=true;});
    const addTag = async (text: string) => {
      const input = audience.locator('input:not([type="checkbox"])');
      if (!await input.isVisible()) await audience.getByRole("button", { name: "+ Ajouter une clientèle", exact: true }).click();
      await input.fill(text); await input.press("Enter");
      await audience.getByText(text, { exact: true }).waitFor();
    };
    await addTag("Clientèle avant requête");
    await waitForWrite(page, "ai-memory", 1);
    await addTag("Clientèle pendant requête");
    await page.getByRole("button", { name: "Fermer", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).navigationCalls.length), 0);
    await releaseWrite(page, "ai-memory", 0);
    await audience.getByText("Clientèle pendant requête", { exact: true }).waitFor();
    await waitForWrite(page, "ai-memory", 2);
    const latest = await page.evaluate(() => (window as unknown as FixtureWindow).fixtureWrites.filter(write => write.kind === "ai-memory")[1].payload);
    assert.ok(((latest.memory as Record<string, unknown>).targetAudiences as string[]).includes("Clientèle pendant requête"));
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).navigationCalls.length), 0, "exit waits until the latest draft is persisted");
    await releaseWrite(page, "ai-memory", 1);
    await page.waitForFunction(() => (window as unknown as FixtureWindow).navigationCalls.length === 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("profile typing during an upsert survives and a second save completes before exit", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = await setup(page);
    const company = page.locator('[data-profile-form-grid] input[autocomplete="organization"]');
    await page.evaluate(() => {const state=window as unknown as FixtureWindow;state.allowWrites=true;state.holdWrites=true;});
    await company.fill("Atelier première version");
    await waitForWrite(page, "profiles", 1);
    await company.fill("Atelier dernière version");
    await page.getByRole("button", { name: "Fermer", exact: true }).click();
    await releaseWrite(page, "profiles", 0);
    assert.equal(await company.inputValue(), "Atelier dernière version");
    await waitForWrite(page, "profiles", 2);
    const latest = await page.evaluate(() => (window as unknown as FixtureWindow).fixtureWrites.filter(write => write.kind === "profiles")[1].payload);
    assert.equal(latest.company_legal_name, "Atelier dernière version");
    assert.equal(latest.user_id, "00000000-0000-4000-8000-000000000001");
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).navigationCalls.length), 0);
    await releaseWrite(page, "profiles", 1);
    await page.waitForFunction(() => (window as unknown as FixtureWindow).navigationCalls.length === 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("changing the active account during profile authentication cannot write the old draft into the new account", { timeout: 20_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = await setup(page);
    await page.evaluate(() => {const state=window as unknown as FixtureWindow;state.allowWrites=true;state.holdAuth=true;});
    await page.locator('[data-profile-form-grid] input[autocomplete="organization"]').fill("Brouillon du compte précédent");
    await page.waitForFunction(() => (window as unknown as FixtureWindow).authWaiters.length === 1, undefined, { timeout: 7_000 });
    await page.evaluate(() => {
      const state=window as unknown as FixtureWindow;
      state.activeAccount="00000000-0000-4000-8000-000000000002";state.holdAuth=false;state.releaseFixtureAuth(0);
    });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).fixtureWrites.length), 0);
    assert.equal(await page.locator('[data-profile-form-grid] input[autocomplete="organization"]').inputValue(), "Brouillon du compte précédent");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("profession changes during an activity save are retained and flushed together with ADN before exit", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = await setup(page);
    await page.getByRole("navigation", { name: "Mon entreprise", exact: true }).getByRole("button", { name: "Activité", exact: true }).click();
    await page.getByRole("button", { name: "Parcourir les secteurs et métiers manuellement", exact: true }).click();
    const profession = page.getByRole("textbox", { name: /^Métier/ });
    await profession.waitFor();
    await page.evaluate(() => {const state=window as unknown as FixtureWindow;state.allowWrites=true;state.holdWrites=true;});
    await profession.fill("Conseil première version");
    await waitForWrite(page, "business_profiles", 1);
    await profession.fill("Conseil dernière version");
    await page.getByRole("button", { name: "Fermer", exact: true }).click();
    await releaseWrite(page, "business_profiles", 0);
    assert.equal(await profession.inputValue(), "Conseil dernière version");
    await waitForWrite(page, "ai-memory", 1); await releaseWrite(page, "ai-memory", 0);
    await waitForWrite(page, "business_profiles", 2);
    const latest = await page.evaluate(() => (window as unknown as FixtureWindow).fixtureWrites.filter(write => write.kind === "business_profiles")[1].payload);
    assert.equal(latest.sector, "[[SECTOR:autre]] Conseil dernière version");
    const businessPayloads = await page.evaluate(() => (window as unknown as FixtureWindow).fixtureWrites.filter(write => write.kind === "business_profiles").map(write => write.payload));
    for (const payload of businessPayloads) {
      for (const key of ["business_description", "strengths", "customer_typologies", "intervention_zones", "opening_days", "opening_hours", "services"]) assert.equal(Object.hasOwn(payload,key), false, `profession-only saves must not rewrite the hidden field ${key}`);
    }
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).navigationCalls.length), 0);
    await releaseWrite(page, "business_profiles", 1);
    await waitForWrite(page, "ai-memory", 2); await releaseWrite(page, "ai-memory", 1);
    await page.waitForFunction(() => (window as unknown as FixtureWindow).navigationCalls.length === 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
