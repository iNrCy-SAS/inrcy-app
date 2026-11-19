import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium, type Browser } from "@playwright/test";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const email = "synthetic+basic@example.invalid", password = "Synthetic!Password123", ticket = "synthetic-basic-private-ticket";
const receipt = () => ({ email, password, ticket, expires_at: new Date(Date.now() + 3600000).toISOString(), login_url: "https://app.inrcy.com/api/auth/signup-access" });
const php = read("ops/wordpress-basic-signup/inrcy-basic-signup.php");
const markup = php.slice(php.indexOf('<main class="inrcy-basic-page">'), php.indexOf("</main>") + 7)
  .replace(/<\?php if \(!\$configured\) : \?>[\s\S]*?<\?php endif; \?>/, "")
  .replace(/<\?php[\s\S]*?\?>/g, "");

async function fixture(browser: Browser, failFirst = false, trialReceipt = false, themeCollision = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 } });
  const page = await context.newPage(), errors: string[] = [], posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  page.on("pageerror", error => errors.push(error.message));
  let attempts = 0;
  await context.route("**/*", async route => {
    const request = route.request(), url = request.url();
    if (url === "https://inrcy.com/basique/") {
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><style>${read("ops/wordpress-basic-signup/basic-access.css")}${read("ops/wordpress-basic-signup/basic-signup.css")}</style>${themeCollision ? '<style>body.elementor-kit-1363{color:white;background:transparent;font-family:Georgia,serif;font-size:21px;line-height:1.9}</style>' : ""}</head><body class="inrcy-basic-standalone${themeCollision ? " elementor-kit-1363" : ""}">${markup}<script>var callbacks=[];window.jQuery=function(target){return{on:function(name,cb){callbacks.push({name,cb});return this;},off:function(name){callbacks=callbacks.filter(item=>item.name!==name);return this;},trigger:function(name,args){callbacks.filter(item=>item.name.split('.')[0]===name).forEach(item=>item.cb({target},...(args||[])));}}};window.inrcyBasicSignupAccessConfig={showBooking:"",signupFormName:"inrcy_basic_signup"};window.inrcyBasicSignupConfig={ajaxUrl:"https://inrcy.com/wp-admin/admin-ajax.php",nonce:"synthetic-public-nonce"};</script><script>${read("ops/wordpress-basic-signup/basic-access.js")}</script><script>${read("ops/wordpress-meta-attribution/inrcy-meta-attribution.js")}</script><script>${read("ops/wordpress-basic-signup/basic-signup.js")}</script></body></html>` });
      return;
    }
    if (request.method() === "POST") posts.push({ url, body: request.postData() ?? "", headers: request.headers() });
    if (url.endsWith("admin-ajax.php")) {
      attempts += 1;
      if (failFirst && attempts === 1) await route.fulfill({ status: 409, json: { success: false, data: { message: "Un compte existe déjà avec cet e-mail." } } });
      else await route.fulfill({ json: { success: true, data: { direct_signup: !trialReceipt, activation_required: !trialReceipt, trial_days: trialReceipt ? 21 : 0, trial_end_at: trialReceipt ? new Date(Date.now() + 21 * 86400000).toISOString() : null, inrcy_signup_access: receipt() } } });
    } else if (url.endsWith("/api/auth/signup-access")) await route.fulfill({ contentType: "text/html", body: "<h1>Synthetic Basic account</h1>" });
    else await route.fulfill({ body: "" });
  });
  await page.goto("https://inrcy.com/basique/");
  await page.getByLabel("Nom", { exact: true }).fill("Synthetic");
  await page.getByLabel("Prénom", { exact: true }).fill("Basic");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Tél.", { exact: true }).fill("0102030405");
  await page.getByRole("checkbox").check();
  return { context, page, posts, errors };
}

test("Basic page submits once, preserves attribution and reveals access without an appointment; only its ticket enters the new tab", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser);
    await f.page.evaluate(() => {
      const form = document.querySelector('form[name="inrcy_basic_signup"]') as HTMLFormElement;
      form.requestSubmit(); form.requestSubmit();
    });
    await f.page.getByRole("heading", { name: "Votre compte est prêt !" }).waitFor();
    assert.equal(f.posts.length, 1);
    assert.match(f.posts[0].body, /form_fields\[event_id\]/);
    assert.match(f.posts[0].body, /synthetic-public-nonce/);
    assert.equal(f.posts[0].headers["x-trial-signup-secret"], undefined);
    assert.equal(await f.page.getByLabel("Votre mot de passe temporaire", { exact: true }).inputValue(), password);
    assert.equal(await f.page.getByLabel("Votre mot de passe temporaire", { exact: true }).getAttribute("type"), "password");
    assert.equal(await f.page.locator("#inrcy-visio-reopen").count(), 0);
    assert.doesNotMatch(await f.page.locator("body").innerText(), /21 jours|Réserver ma mise en route/);
    assert.match(await f.page.locator("body").innerText(), /Résiliation avec préavis : un renouvellement mensuel supplémentaire\./);
    const popup = f.context.waitForEvent("page");
    await f.page.getByRole("button", { name: "Accéder à mon compte" }).click();
    const account = await popup;
    await account.getByRole("heading", { name: "Synthetic Basic account" }).waitFor();
    const post = f.posts.find(item => item.url.endsWith("/api/auth/signup-access"));
    assert.ok(post); assert.deepEqual([...new URLSearchParams(post.body)], [["ticket", ticket]]);
    assert.equal(post.headers.origin, "https://inrcy.com");
    assert.equal(await account.evaluate(() => window.opener), null);
    const storage = await f.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.equal(storage.includes(password) || storage.includes(ticket), false);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("a rejected Basic signup displays no credentials and leaves the form available to correct and retry", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, true), submit = f.page.getByRole("button", { name: "Créer mon compte et choisir mon offre" });
    await submit.click();
    await f.page.getByText("Un compte existe déjà avec cet e-mail.", { exact: true }).waitFor();
    assert.equal(await f.page.getByRole("dialog").count(), 0);
    assert.equal(await submit.isEnabled(), true);
    await submit.click();
    await f.page.getByRole("heading", { name: "Votre compte est prêt !" }).waitFor();
    assert.equal(f.posts.length, 2);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("a trial receipt cannot open the Basic account-access modal", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, false, true);
    await f.page.getByRole("button", { name: "Créer mon compte et choisir mon offre" }).click();
    await f.page.getByText("La création du compte n’a pas pu être confirmée. Réessayez plus tard.", { exact: true }).waitFor();
    assert.equal(await f.page.getByRole("dialog").count(), 0);
    assert.equal(await f.page.getByLabel("Votre mot de passe temporaire", { exact: true }).count(), 0);
    assert.equal(f.posts.length, 1);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("the Basic price and steps remain readable when Elementor applies white text and 21px typography after the plugin stylesheet", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, false, false, true);
    const computed = await f.page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return { background: style("body").backgroundColor, price: style(".inrcy-basic-price").color,
        steps: [...document.querySelectorAll(".inrcy-basic-pitch li")].map(element => getComputedStyle(element).color),
        pageFontSize: style(".inrcy-basic-page").fontSize, heroFontSize: style(".inrcy-basic-hero").fontSize,
        heroLineHeight: style(".inrcy-basic-hero").lineHeight, heroFontFamily: style(".inrcy-basic-hero").fontFamily };
    });
    assert.equal(computed.background, "rgb(244, 247, 252)");
    assert.equal(computed.price, "rgb(19, 36, 66)");
    assert.deepEqual(computed.steps, ["rgb(19, 36, 66)", "rgb(19, 36, 66)", "rgb(19, 36, 66)"]);
    assert.equal(computed.pageFontSize, "16px"); assert.equal(computed.heroFontSize, "16px"); assert.equal(computed.heroLineHeight, "24px");
    assert.match(computed.heroFontFamily, /Inter/);
    await f.page.getByText("Abonnement mensuel. Sans période d’essai.", { exact: true }).waitFor();
    assert.equal(f.posts.length, 0); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});
