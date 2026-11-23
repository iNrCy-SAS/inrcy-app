import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Browser } from "@playwright/test";
import { pages, read, render, type View } from "./php-fixture.mts";

const email = "synthetic+basic@example.invalid", password = "Synthetic!Password123", ticket = "synthetic-basic-private-ticket";
type FixtureOptions = { failFirst?: boolean; trialReceipt?: boolean; emptyTicket?: boolean; expiredTicket?: boolean; marketingConsent?: boolean; legacy?: boolean; preview?: boolean; noJS?: boolean };
async function fixture(browser: Browser, options: FixtureOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: !options.noJS });
  const page = await context.newPage(), errors: string[] = [], unexpected: string[] = [], posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  page.setDefaultTimeout(8000);
  const paths = new Map(Object.entries(pages).map(([view, path]) => [String(path), view as View]));
  const renderOptions = { marketingConsent: options.marketingConsent, ...(options.legacy ? { options: { inrcy_basic_signup_page_id: 12815, inrcy_basic_site_enabled: "0" } } : {}), ...(options.preview ? { admin: true, preview: true } : {}) };
  page.on("pageerror", error => errors.push(error.message));
  let attempts = 0;
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "POST") posts.push({ url: request.url(), body: request.postData() ?? "", headers: request.headers() });
    if (url.origin === "https://inrcy.com" && paths.has(url.pathname)) {
      const view = (options.preview && url.searchParams.get("inrcy_basic_view") || paths.get(url.pathname)) as View;
      assert.ok(Object.hasOwn(pages, view));
      await route.fulfill({ contentType: "text/html", body: render(view, { ...renderOptions, query: Object.fromEntries(url.searchParams) }) }); return;
    }
    if (url.pathname === "/wp-admin/admin-ajax.php" && request.method() === "POST") {
      attempts += 1;
      if (options.failFirst && attempts === 1) await route.fulfill({ status: 409, json: { success: false, data: { message: "Un compte existe déjà avec cet e-mail." } } });
      else await route.fulfill({ json: { success: true, data: { direct_signup: !options.trialReceipt, activation_required: !options.trialReceipt, trial_days: options.trialReceipt ? 21 : 0, trial_end_at: options.trialReceipt ? "2099-01-01" : null, inrcy_signup_access: { email, password, ticket: options.emptyTicket ? "" : ticket, expires_at: options.expiredTicket ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z", login_url: "https://app.inrcy.com/api/auth/signup-access" } } } });
      return;
    }
    if (url.origin === "https://app.inrcy.com" && (url.pathname === "/api/auth/signup-access" || url.pathname === "/login")) { await route.fulfill({ contentType: "text/html", body: "<h1>Synthetic Basic account</h1>" }); return; }
    const asset = url.pathname.split("/").at(-1)!;
    if (url.pathname.startsWith("/wp-content/plugins/inrcy-basic-signup/") && ["basic-access.css", "basic-access.js", "basic-signup.css", "basic-signup.js", "basic-site.css", "basic-home-native.css", "basic-site.js", "basic-meta-attribution.js"].includes(asset)) {
      await route.fulfill({ contentType: asset.endsWith(".css") ? "text/css" : "text/javascript", body: read("ops/wordpress-basic-signup/" + asset) }); return;
    }
    if (url.pathname === "/__basic-preview/meta-attribution.js") { await route.fulfill({ contentType: "text/javascript", body: read("ops/wordpress-meta-attribution/inrcy-meta-attribution.js") }); return; }
    if (url.origin === "https://cmp.example.invalid" && /^\/assets\/css\/document(?:-grid)?\.min\.css$/.test(url.pathname)) { await route.fulfill({ contentType: "text/css", body: "/* synthetic CMP asset: production settings are verified separately */" }); return; }
    if (asset === "logo-inrcy-transparent.png" || url.pathname === "/favicon.ico") { await route.fulfill({ status: 204 }); return; }
    if (request.resourceType() === "image" && url.origin === "https://inrcy.com" && url.pathname.startsWith("/wp-content/uploads/")) { await route.fulfill({ status: 204 }); return; }
    unexpected.push(request.method() + " " + request.url()); await route.abort();
  });
  await page.goto("https://inrcy.com/basique/inscription/");
  const fill = async () => {
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Synthetic");
    await page.getByRole("textbox", { name: "Prénom", exact: true }).fill("Basic");
    await page.getByRole("textbox", { name: "E-mail", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Tél.", exact: true }).fill("0102030405");
    await page.getByRole("checkbox").check();
  };
  const clean = () => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); };
  return { context, page, posts, fill, clean };
}

test("real PHP page submits once; dedicated plus unchanged global attribution never enriches the private ticket POST", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { marketingConsent: true }); await f.fill();
    await f.page.evaluate(() => { const form = document.querySelector('form[name="inrcy_basic_signup"]') as HTMLFormElement; form.requestSubmit(); form.requestSubmit(); });
    await f.page.getByRole("heading", { name: "Votre compte est prêt !" }).waitFor();
    assert.equal(f.posts.length, 1); assert.match(f.posts[0].body, /form_fields\[event_id\]/);
    assert.equal(f.posts[0].headers["x-trial-signup-secret"], undefined);
    assert.equal(await f.page.getByLabel("Votre mot de passe temporaire", { exact: true }).inputValue(), password);
    assert.equal(await f.page.getByLabel("Votre mot de passe temporaire", { exact: true }).getAttribute("type"), "password");
    assert.equal(await f.page.locator("#inrcy-visio-reopen").count(), 0);
    const popup = f.context.waitForEvent("page");
    await f.page.getByRole("button", { name: "Accéder à mon compte" }).click();
    const account = await popup; await account.getByRole("heading", { name: "Synthetic Basic account" }).waitFor();
    const post = f.posts.find(item => new URL(item.url).pathname === "/api/auth/signup-access")!;
    assert.ok(post); assert.deepEqual([...new URLSearchParams(post.body)], [["ticket", ticket]]);
    assert.equal(new URL(post.url).search, "?entry=basique"); assert.equal(post.headers.origin, "https://inrcy.com");
    assert.equal(await account.evaluate(() => window.opener), null);
    const persisted = await f.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, pixel: (window as unknown as { __basicPreviewPixel: unknown[] }).__basicPreviewPixel }));
    assert.equal(persisted.includes(password) || persisted.includes(ticket), false);
    f.clean();
  } finally { await browser.close(); }
});

test("failed signup permits correction/retry and rejects a trial receipt without exposing credentials", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const retry = await fixture(browser, { failFirst: true }); await retry.fill();
    const submit = retry.page.getByRole("button", { name: "Créer mon compte et découvrir iNrCy" });
    await submit.click(); await retry.page.getByText("Un compte existe déjà avec cet e-mail.", { exact: true }).waitFor();
    assert.equal(await retry.page.getByRole("dialog").count(), 0); assert.equal(await submit.isEnabled(), true);
    await submit.click(); await retry.page.getByRole("heading", { name: "Votre compte est prêt !" }).waitFor(); assert.equal(retry.posts.length, 2); retry.clean();
    const trial = await fixture(browser, { trialReceipt: true }); await trial.fill();
    await trial.page.getByRole("button", { name: "Créer mon compte et découvrir iNrCy" }).click();
    await trial.page.getByText("La création du compte n’a pas pu être confirmée. Réessayez plus tard.", { exact: true }).waitFor();
    assert.equal(await trial.page.getByRole("dialog").count(), 0); trial.clean();
  } finally { await browser.close(); }
});

test("empty or expired tickets keep manual login in the Basic entry with only email, never a password", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const options of [{ emptyTicket: true }, { expiredTicket: true }]) {
      const f = await fixture(browser, options); await f.fill();
      await f.page.getByRole("button", { name: "Créer mon compte et découvrir iNrCy" }).click();
      await f.page.getByRole("heading", { name: "Votre compte est prêt !" }).waitFor();
      if (options.expiredTicket) await f.page.getByRole("button", { name: "Accéder à mon compte" }).click();
      const link = f.page.getByRole("link", { name: options.expiredTicket ? "Ouvrir la connexion" : "Accéder à mon compte" });
      await link.waitFor();
      const url = new URL((await link.getAttribute("href"))!);
      assert.equal(url.pathname, "/login"); assert.deepEqual([...url.searchParams], [["entry", "basique"], ["email", email]]);
      assert.equal(f.posts.length, 1); f.clean();
    }
  } finally { await browser.close(); }
});

test("mobile signup stays compact/readable despite Elementor typography, and the menu supports Escape/focus", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser);
    const first = await f.page.getByRole("textbox", { name: "Nom", exact: true }).boundingBox();
    assert.ok(first && first.y < 400);
    const dimensions = await f.page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, font: getComputedStyle(document.querySelector(".inrcy-basic-site")!).fontSize, color: getComputedStyle(document.querySelector(".basic-site-signup-inline-price")!).color }));
    assert.equal(dimensions.client, dimensions.scroll); assert.equal(dimensions.font, "16px"); assert.notEqual(dimensions.color, "rgb(255, 255, 255)");
    const menu = f.page.getByRole("button", { name: "Menu" }); await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"), "true"); await f.page.keyboard.press("Escape");
    assert.equal(await menu.getAttribute("aria-expanded"), "false"); assert.equal(await menu.evaluate(node => node === document.activeElement), true);
    assert.equal(f.posts.length, 0); f.clean();
  } finally { await browser.close(); }
});

test("cookie documents preserve exact shortcode controls and no-JS confinement; late manager links preserve query/fragment and click behavior", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const plain = await fixture(browser, { noJS: true }); await plain.page.goto("https://inrcy.com/basique/cookies/");
    assert.equal(await plain.page.locator("#cmplz-document a").first().getAttribute("href"), "https://inrcy.com/basique/");
    assert.equal(await plain.page.getByRole("link", { name: "Aller aux préférences" }).getAttribute("href"), "#cookie-preferences");
    assert.equal(await plain.page.getByRole("link", { name: "Fournisseur externe" }).getAttribute("href"), "https://provider.example.invalid/privacy");
    assert.equal(await plain.page.locator("#cmplz-cookies-overview").count(), 1); plain.clean();
    for (const preview of [false, true]) {
      const f = await fixture(browser, { preview }); await f.page.goto("https://inrcy.com/basique/cookies/");
      await f.page.evaluate(() => {
        const manager = document.getElementById("cmplz-manage-consent-container")!;
        manager.insertAdjacentHTML("beforeend", '<a href="#cmplz-manage-consent-container" data-local>Gérer localement</a><a href="https://www.inrcy.com/politique-de-confidentialite/?lang=fr#details" data-policy>Document</a>');
        manager.querySelector("[data-local]")!.addEventListener("click", event => { event.preventDefault(); manager.setAttribute("data-clicked", "1"); });
        manager.querySelector("[data-cookie-choice=deny]")!.addEventListener("click", () => manager.setAttribute("data-choice", "deny"));
      });
      await f.page.waitForFunction(() => document.querySelector("[data-policy]")!.getAttribute("href")!.includes("/basique/"));
      assert.equal(await f.page.locator("[data-local]").getAttribute("href"), "#cmplz-manage-consent-container");
      const target = new URL((await f.page.locator("[data-policy]").getAttribute("href"))!);
      assert.equal(target.searchParams.get("lang"), "fr"); assert.equal(target.hash, "#details");
      assert.equal(preview ? target.searchParams.get("inrcy_basic_view") : target.pathname, preview ? "privacy" : "/basique/confidentialite/");
      await f.page.locator("[data-local]").click(); assert.equal(await f.page.locator("#cmplz-manage-consent-container").getAttribute("data-clicked"), "1");
      await f.page.locator("[data-cookie-choice=deny]").click(); assert.equal(await f.page.locator("#cmplz-manage-consent-container").getAttribute("data-choice"), "deny");
      assert.equal(f.posts.length, 0); f.clean();
    }
  } finally { await browser.close(); }
});

test("navigation retains campaign landing and event source across home/features/signup, with marketing denied or accepted", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const ids: string[] = [];
    for (const consent of [false, true]) {
      const f = await fixture(browser, { marketingConsent: consent });
      await f.page.goto("https://inrcy.com/basique/?utm_source=meta&utm_campaign=synthetic-campaign");
      await f.page.setViewportSize({ width: 1200, height: 900 });
      await f.page.locator("#basic-site-navigation").getByRole("link", { name: "Nos Outils", exact: true }).click();
      await f.page.locator(".basic-site-header").getByRole("link", { name: "Créer mon compte", exact: true }).click();
      assert.equal(f.posts.length, 0); await f.fill();
      const fields = await f.page.locator('form[name="inrcy_basic_signup"]').evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)));
      assert.equal(fields["form_fields[utm_campaign]"], "synthetic-campaign");
      assert.equal(fields["form_fields[landing_page_url]"], "https://inrcy.com/basique/?utm_source=meta&utm_campaign=synthetic-campaign");
      assert.equal(new URL(String(fields["form_fields[event_source_url]"])).pathname, "/basique/inscription/");
      assert.equal(fields["form_fields[meta_tracking_consent]"], String(consent));
      ids.push(String(fields["form_fields[event_id]"]));
      await f.page.getByRole("button", { name: "Créer mon compte et découvrir iNrCy" }).click();
      await f.page.getByRole("heading", { name: "Votre compte est prêt !" }).waitFor();
      const events = await f.page.evaluate(() => (window as unknown as { __basicPreviewPixel: unknown[][] }).__basicPreviewPixel);
      const leads = events.filter(item => item[1] === "Lead");
      assert.equal(leads.length, consent ? 1 : 0);
      if (consent) { assert.equal((leads[0][3] as { eventID: string }).eventID, ids.at(-1)); assert.doesNotMatch(JSON.stringify(leads), /essai|21 jours|Synthetic!Password/i); }
      f.clean();
    }
    assert.notEqual(ids[0], ids[1]); assert.ok(ids.every(id => id.startsWith("inrcy-lead-")));
  } finally { await browser.close(); }
});

test("original marketing widgets retain working comparison, FAQ and dedicated tool links", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser);
    await f.page.goto("https://inrcy.com" + pages.pricing);
    const card = f.page.locator('[data-plan="basic"]');
    const annual = card.getByRole("button", { name: /Annuel/i });
    await annual.click();
    assert.equal(await annual.getAttribute("aria-pressed"), "true");
    assert.match(await card.locator("[data-price]").innerText(), /309/);
    assert.match(await card.locator("[data-price-period]").innerText(), /an/);
    await card.getByRole("button", { name: /Mensuel/i }).click();
    assert.match(await card.locator("[data-price]").innerText(), /29/);

    await f.page.goto("https://inrcy.com" + pages.faq);
    const search = f.page.getByRole("searchbox");
    await search.fill("Question inexistante 789xyz");
    await f.page.getByText("Aucun résultat trouvé", { exact: true }).waitFor();
    await search.fill("");
    const question = f.page.locator('.ifaq-question[aria-expanded="false"]:visible').first();
    const label = (await question.locator("strong").innerText()).trim();
    await question.click();
    assert.equal(await f.page.locator(".ifaq-question").filter({ hasText: label }).getAttribute("aria-expanded"), "true");

    await f.page.goto("https://inrcy.com" + pages.features);
    const tools = await f.page.locator('#nos-outils a[href*="outil="]').evaluateAll(anchors => anchors.map(a => (a as HTMLAnchorElement).href));
    assert.equal(new Set(tools).size, 8);
    const headings = new Set<string>();
    for (const href of new Set(tools)) {
      assert.equal(new URL(href).pathname, pages.features);
      await f.page.goto(href);
      headings.add((await f.page.locator("main h1").innerText()).trim());
      assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), href + " overflows on mobile");
      assert.doesNotMatch(await f.page.locator("body").innerText(), /essai gratuit|essayer gratuitement|21\s*jours/i);
      const leaked = await f.page.locator('a[href]').evaluateAll(anchors => anchors.map(a => new URL((a as HTMLAnchorElement).href)).filter(u => /^(?:www\.)?inrcy\.com$/.test(u.hostname) && !u.pathname.startsWith("/basique/")).map(u => u.href));
      assert.deepEqual(leaked, [], href);
    }
    assert.equal(headings.size, 8, "Each tool must open its own content");
    assert.equal(f.posts.length, 0);
    f.clean();
  } finally { await browser.close(); }
});
