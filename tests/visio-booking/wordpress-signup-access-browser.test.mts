import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium, type Browser, type Page } from "@playwright/test";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const email = "synthetic+signup@example.com", password = "Synthetic!Pass1234567", ticket = "synthetic-private-ticket";
const loginUrl = "https://app.inrcy.com/api/auth/signup-access";
const access = () => ({ email, password, ticket, expires_at: new Date(Date.now() + 3_600_000).toISOString(), login_url: loginUrl });
type State = { signupSuccess: (event: unknown, response: unknown) => void; calls: Array<{ url: string; body: string }>; };

async function fixture(browser: Browser, options: { showBooking?: boolean; width?: number } = {}) {
  const context = await browser.newContext({ viewport: { width: options.width ?? 1000, height: 900 } });
  const page = await context.newPage();
  const posts: Array<{ url: string; body: string; origin: string }> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = request.url();
    const headers = { "Access-Control-Allow-Origin": "https://inrcy.com", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (url === "https://inrcy.com/inscription/") {
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><style>${read("ops/wordpress-visio-booking/inrcy-visio-booking.css")}</style></head><body><button id="before">Before</button><form name="essai_inrcy_30j"><input name="email"></form><script>window.calls=[];window.jQuery=function(){return{on:function(event,callback){window.signupSuccess=callback;}}};window.inrcyVisioBookingConfig=${JSON.stringify({ showBooking: options.showBooking ?? true, signupFormName: "essai_inrcy_30j", trackingUrl: "https://app.inrcy.com/api/public/visio-booking/event", availabilityUrl: "https://app.inrcy.com/api/public/visio-booking/availability", bookingUrl: "https://app.inrcy.com/api/public/visio-booking/book" })};</script><script>${read("ops/wordpress-visio-booking/inrcy-visio-booking.js")}</script></body></html>` });
      return;
    }
    if (request.method() === "POST") posts.push({ url, body: request.postData() ?? "", origin: request.headers().origin ?? "" });
    if (url.endsWith("/availability")) {
      await route.fulfill({ headers, json: { ok: true, days: [{ label: "Lundi 23 novembre", slots: [{ start: "2026-11-23T09:00:00.000Z", label: "10:00" }] }] } });
    } else if (url.endsWith("/book")) {
      await route.fulfill({ headers, json: { ok: true, booking: { dateLabel: "Lundi 23 novembre", timeLabel: "10:00", meetUrl: "https://meet.google.com/synthetic" } } });
    } else if (url === loginUrl) {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Synthetic account opened</h1>" });
    } else await route.fulfill({ headers, json: { ok: true } });
  });
  await page.goto("https://inrcy.com/inscription/");
  return { context, page, posts, errors };
}

async function signup(page: Page, value: unknown = access(), booking = true) {
  await page.evaluate(({ value, booking }) => {
    (window as unknown as State).signupSuccess({ target: document }, { data: {
      ...(booking ? { inrcy_booking_token: "synthetic-booking-token" } : {}), inrcy_signup_access: value,
    } });
  }, { value, booking });
}

async function expectCredentials(page: Page) {
  await page.getByRole("heading", { name: "Votre compte est prêt !" }).waitFor();
  assert.equal(await page.getByLabel("Votre identifiant", { exact: true }).inputValue(), email);
  const field = page.getByLabel("Votre mot de passe temporaire", { exact: true });
  assert.equal(await field.getAttribute("type"), "password");
  assert.equal(await field.inputValue(), password);
  assert.equal(await page.locator("input[name='ticket']").count(), 0, "ticket enters the DOM only during the POST gesture");
  const persisted = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert.equal(persisted.includes(email), false); assert.equal(persisted.includes(password), false); assert.equal(persisted.includes(ticket), false);
  assert.equal(page.url().includes(password), false); assert.equal(page.url().includes(ticket), false);
}

test("refusing, closing and escaping the booking offer reveal private new-account access; replay and dismissal do not reopen it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const action of ["skip", "close", "escape"] as const) {
      const f = await fixture(browser);
      try {
        await signup(f.page);
        await f.page.waitForTimeout(250);
        assert.deepEqual(f.errors, [], await f.page.locator("body").innerText());
        assert.equal(await f.page.getByRole("dialog").count(), 1, await f.page.locator("body").innerText());
        assert.equal(await f.page.getByRole("button", { name: "Réserver ma mise en route offerte", exact: true }).count(), 1, await f.page.locator("body").innerText());
        await f.page.getByRole("button", { name: "Réserver ma mise en route offerte", exact: true }).waitFor({timeout:3000});
        if (action === "skip") await f.page.getByRole("button", { name: "Je choisirai plus tard" }).click();
        if (action === "close") await f.page.getByRole("button", { name: "Fermer", exact: true }).click();
        if (action === "escape") await f.page.keyboard.press("Escape");
        await expectCredentials(f.page);
        await f.page.getByRole("button", { name: "Afficher", exact: true }).click();
        assert.equal(await f.page.getByLabel("Votre mot de passe temporaire", { exact: true }).getAttribute("type"), "text");
        await f.page.getByRole("button", { name: "Masquer", exact: true }).click();
        await f.page.keyboard.press("Escape");
        assert.equal(await f.page.getByRole("dialog").count(), 0);
        await signup(f.page);
        await f.page.waitForTimeout(250);
        assert.equal(await f.page.getByRole("dialog").count(), 0);
        assert.equal(JSON.stringify(f.posts).includes(password), false); assert.equal(JSON.stringify(f.posts).includes(ticket), false); assert.equal(JSON.stringify(f.posts).includes(email), false);
        assert.deepEqual(f.errors, []);
      } finally { await f.context.close(); }
    }
  } finally { await browser.close(); }
});

test("successful appointment keeps its confirmation then opens credentials on Finish; only the ticket is posted to a new tab", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser);
    await signup(f.page);
    await f.page.getByRole("button", { name: "Réserver ma mise en route offerte", exact: true }).click();
    await f.page.getByRole("button", { name: "10:00", exact: true }).click();
    await f.page.getByRole("button", { name: "Confirmer ce rendez-vous" }).click();
    await f.page.getByRole("heading", { name: "C’est réservé !" }).waitFor();
    assert.equal(await f.page.getByLabel("Votre mot de passe temporaire", { exact: true }).count(), 0);
    await f.page.getByRole("button", { name: "Terminer", exact: true }).click();
    await expectCredentials(f.page);
    const newTab = f.context.waitForEvent("page");
    await f.page.getByRole("button", { name: "Accéder à mon compte" }).click();
    const account = await newTab;
    await account.getByRole("heading", { name: "Synthetic account opened" }).waitFor();
    assert.equal(account.url(), loginUrl); assert.equal(await account.evaluate(() => window.opener), null);
    const loginPosts = f.posts.filter(item => item.url === loginUrl);
    assert.equal(loginPosts.length, 1); assert.deepEqual([...new URLSearchParams(loginPosts[0].body).entries()], [["ticket", ticket]]);
    assert.equal(loginPosts[0].origin, "https://inrcy.com");
    assert.equal(f.posts.filter(item => !item.url.endsWith("/signup-access")).some(item => item.body.includes(ticket) || item.body.includes(password) || item.body.includes(email)), false);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("booking disabled still reveals access, expires to a normal login link, and stays usable at mobile size", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { showBooking: false, width: 390 });
    await signup(f.page, { ...access(), expires_at: new Date(Date.now() - 1).toISOString() }, false);
    await expectCredentials(f.page);
    assert.equal(await f.page.getByRole("button", { name: "Réserver ma mise en route offerte", exact: true }).count(), 0);
    await f.page.getByRole("button", { name: "Accéder à mon compte" }).click();
    const fallback = f.page.getByRole("link", { name: "Ouvrir la connexion" });
    assert.equal(await fallback.getAttribute("href"), `https://app.inrcy.com/login?email=${encodeURIComponent(email)}`);
    assert.equal(f.posts.some(item => item.url === loginUrl), false);
    const bounds = await f.page.getByRole("dialog").boundingBox(); assert.ok(bounds); assert.ok(bounds.x >= 0); assert.ok(bounds.width <= 390);
    const bodyWidth = await f.page.evaluate(() => document.documentElement.scrollWidth); assert.ok(bodyWidth <= 390);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("untrusted access destinations and malformed receipts never expose credentials", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { showBooking: false });
    await signup(f.page, { ...access(), login_url: "https://foreign.example.invalid/collect" }, false);
    await f.page.waitForTimeout(250);
    assert.equal(await f.page.getByRole("dialog").count(), 0);
    await signup(f.page, { ...access(), password: undefined }, false);
    await f.page.waitForTimeout(250);
    assert.equal(await f.page.getByRole("dialog").count(), 0);
    assert.equal(f.posts.length, 0);
  } finally { await browser.close(); }
});

test("provider handoff unavailable keeps the temporary password and immediately offers the normal prefilled login", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { showBooking: false });
    await signup(f.page, { ...access(), ticket: "" }, false);
    await expectCredentials(f.page);
    const link = f.page.getByRole("link", { name: "Accéder à mon compte", exact: true });
    assert.equal(await link.getAttribute("href"), `https://app.inrcy.com/login?email=${encodeURIComponent(email)}`);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(f.posts.some(item => item.url === loginUrl), false);
    await f.page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.equal(await f.page.getByRole("dialog").count(), 0, "history restoration cannot redisplay a password");
  } finally { await browser.close(); }
});

test("leaving while availability is loading keeps credentials visible when the old response arrives", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser);
    let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await f.context.route("**/visio-booking/availability", async route => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({status:204,headers:{"Access-Control-Allow-Origin":"https://inrcy.com","Access-Control-Allow-Headers":"Content-Type"}});return;
      }
      await pending;
      await route.fulfill({ headers: { "Access-Control-Allow-Origin": "https://inrcy.com" }, json: { ok: true, days: [] } });
    });
    await signup(f.page);
    await f.page.getByRole("button", { name: "Réserver ma mise en route offerte", exact: true }).click();
    await f.page.getByRole("heading", { name: "Préparation de vos créneaux…" }).waitFor();
    await f.page.keyboard.press("Escape");
    await expectCredentials(f.page);
    release!();
    await f.page.waitForTimeout(200);
    await expectCredentials(f.page);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});
