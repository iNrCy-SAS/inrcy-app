import assert from "node:assert/strict";
import test from "node:test";
import { pages, phpJson, read, render, type View } from "./php-fixture.mts";
import { AI_MEDIA_BASIC_MONTHLY_CREDITS } from "../../lib/aiMediaPlanLimits.ts";
import { BOOSTER_PUBLICATION_CHANNELS } from "../../lib/boosterPublicationPolicy.ts";

const plugin = read("ops/wordpress-basic-signup/inrcy-basic-signup.php");
const legacyOptions = { options: { inrcy_basic_signup_page_id: 12815, inrcy_basic_site_enabled: "0" } };
const children = Object.fromEntries(Object.keys(pages).filter(key => key !== "home").map(key => [key, { status: "publish" }]));
const email = "synthetic+basic@example.invalid";
const access = { email, password: "Synthetic!Password123", ticket: "synthetic-private-ticket", expires_at: "2099-01-01T12:00:00Z", login_url: "https://app.inrcy.com/api/auth/signup-access", ignored: "never-public" };
const successful = { ok: true, direct_signup: true, activation_required: true, trial_days: 0, trial_end_at: null, signup_access: access, ignored: "never-public" };
const post = { nonce: "synthetic-inrcy_basic_signup", form_fields: { first_name: "Synthetic", last_name: "Basic", email, phone: "0102030405", consent: "1", signup_mode: "trial", source: "untrusted", utm_campaign: "local-test", event_id: "stable-event-id", meta_tracking_consent: "allow", untrusted: "discard" } };
const submit = (body: unknown, options: Record<string, unknown> = {}) => phpJson("submit", { post, mockRemote: { response: { code: 200 }, body: JSON.stringify(body) }, ...options });

test("the public catalogue agrees with real Basic credit and publication policies", () => {
  const catalogue = phpJson("catalogue");
  assert.equal(catalogue.monthly_price_eur, 29);
  assert.equal(catalogue.monthly_media_credits, AI_MEDIA_BASIC_MONTHLY_CREDITS);
  assert.deepEqual(Object.keys(catalogue.channels).sort(), [...BOOSTER_PUBLICATION_CHANNELS].sort());
  assert.equal(Object.keys(catalogue.channels).length, 11);
});

test("access renderer retains explicit verified differences only, an exact receipt endpoint and ticket-only body", () => {
  const original = read("ops/wordpress-visio-booking/inrcy-visio-booking.js")
    .replace("function inrcyVisioBooking($)", "function inrcyBasicSignupAccess($)")
    .replaceAll("window.inrcyVisioBookingConfig", "window.inrcyBasicSignupAccessConfig")
    .replace("action=\"' + SIGNUP_ACCESS_URL + '\" target=", "action=\"' + SIGNUP_ACCESS_URL + '?entry=basique\" target=")
    .replaceAll("https://app.inrcy.com/login?email=", "https://app.inrcy.com/login?entry=basique&email=");
  assert.equal(read("ops/wordpress-basic-signup/basic-access.js"), original);
  assert.equal(read("ops/wordpress-basic-signup/basic-access.css"), read("ops/wordpress-visio-booking/inrcy-visio-booking.css"));
  assert.ok(plugin.includes("'inrcyBasicSignupAccessConfig', array('showBooking' => false"));
  assert.ok(plugin.includes("update_option(INRCY_BASIC_SIGNUP_SECRET_OPTION, $secret, false)"));
});

test("real PHP preserves the disabled legacy root; all dedicated views isolate copy, links and full legal bodies", () => {
  const legacy = render("home", legacyOptions);
  assert.match(legacy, /Votre présence professionnelle commence ici/);
  assert.doesNotMatch(legacy, /basic-site\.css|basic-site-navigation/);
  for (const view of Object.keys(pages) as View[]) {
    const html = render(view);
    assert.match(html, /basic-site-navigation/);
    assert.doesNotMatch(html, /\b21\s*j(?:ours)?\b|période d[’']essai|essai gratuit|essayer gratuitement|synthetic-local-token-never-valid-in-production/i);
    assert.match(html, /app\.inrcy\.com\/login\?entry=basique/);
    for (const match of html.matchAll(/<a\s[^>]*?\bhref\s*=\s*(["'])([^"']*)\1/gi)) {
      const url = new URL(match[2].replaceAll("&amp;", "&"), "https://inrcy.com" + pages[view]);
      if (/^(?:www\.)?inrcy\.com$/.test(url.hostname)) assert.ok(url.pathname.startsWith("/basique/"), view + " leaked " + url);
    }
    assert.ok(html.includes('"showBooking":""')); // WordPress converts false to "".
    assert.ok(html.includes('"signupFormName":"inrcy_basic_signup"'));
    if (view === "terms" || view === "privacy" || view === "legal") {
      assert.equal([...html.matchAll(/<article\b/g)].length, { terms: 47, privacy: 38, legal: 19 }[view]);
    }
  }
});

test("partial publication and rollback OFF close child templates and direct shortcodes; admin previews remain available", () => {
  const options = { ...legacyOptions, children };
  const gate = phpJson("gate", options, "signup");
  assert.equal(gate.blocked, true); assert.equal(gate.status, 503); assert.equal(gate.noCache, true);
  assert.doesNotMatch(gate.shortcode, /<form|href=/);
  const html = render("signup", options);
  assert.match(html, /noindex,nofollow/); assert.doesNotMatch(html, /<form|href=|script/);
  assert.equal(phpJson("gate", { ...options, admin: true, preview: true }, "signup").blocked, false);
  assert.match(render("signup", { ...options, admin: true, preview: true }), /form name="inrcy_basic_signup"/);
});

test("page preparation is idempotent, preserves root/conflicts and requires all correct children published before enable", () => {
  const result = phpJson("prepare");
  assert.equal(result.rootUnchanged, true); assert.equal(result.inserts.length, Object.keys(children).length);
  assert.ok(result.inserts.every((page: { post_status: string; post_parent: number }) => page.post_status === "draft" && page.post_parent === 12815));
  assert.deepEqual(result.first.ids, result.second.ids); assert.equal(result.canEnable, false);
  const conflict = phpJson("prepare", { children: { features: { content: '[inrcy_basic_page view="faq"]', status: "publish" } } });
  assert.equal(conflict.inserts.length, Object.keys(children).length - 1); assert.deepEqual(conflict.first.conflicts, ["Fonctionnalités"]);
  assert.equal(phpJson("enable", { children }).canEnable, true);
  assert.equal(phpJson("enable", { children: { ...children, features: { content: '[inrcy_basic_page view="faq"]', status: "publish" } } }).canEnable, false);
  assert.equal(phpJson("enable", { children, legalUnavailable: true }).canEnable, false);
  assert.equal(phpJson("enable", { children, cmpMissing: true }).canEnable, false);
  assert.equal(phpJson("enable", { children, rootPassword: "protected" }).canEnable, false);
  assert.equal(phpJson("enable", { children: { ...children, pricing: { status: "publish", password: "protected" } } }).canEnable, false);
  assert.equal(phpJson("enable", { children: { ...children, signup: { status: "publish", content: '[[inrcy_basic_page view="signup"]]' } } }).canEnable, false);
  assert.equal(phpJson("enable", { children, rootContent: '[[inrcy_basic_signup]]' }).canEnable, false);
});

test("wrapped cookie page explicitly reuses vendor document/grid CSS, inline styling and body class without global policy metadata", () => {
  const html = render("cookies");
  assert.match(html, /https:\/\/cmp\.example\.invalid\/assets\/css\/document\.min\.css/);
  assert.match(html, /id="basic-test-cmp-inline"/);
  assert.match(html, /<body class="[^"]*cmplz-document/);
  assert.match(render("cookies", { cmpGrid: true }), /assets\/css\/document-grid\.min\.css/);
  assert.doesNotMatch(render("home"), /cmp\.example\.invalid|basic-test-cmp-inline/);
  assert.doesNotMatch(read("ops/wordpress-basic-signup/includes/site.php"), /update_post_meta|cmplz_shortcode|cmplz_shortcode_/);
});

test("public directory and editorial pages retain dedicated filtering, pagination and publication boundaries", () => {
  const directory = render("directory");
  assert.match(directory, /action="https:\/\/inrcy\.com\/basique\/annuaire\/"/);
  assert.match(directory, /\/basique\/annuaire\/\?inrcy_page=2&amp;ville=Bruxelles/);
  assert.match(directory, /https:\/\/app\.inrcy\.com\/badge\/synthetic-public-business/);
  const publicPost = { ID: 432, post_title: "Exemple de publication locale", post_name: "publication-locale", post_content: "Article de test", post_status: "publish", category: 90, fixturePage: 2 };
  const article = { query: { article: "432" }, editorialPosts: [publicPost] };
  const published = render("blog", article);
  assert.match(published, /Exemple de publication locale/);
  assert.match(published, /rel="canonical" href="https:\/\/inrcy\.com\/basique\/blog\/\?article=432"/);
  for (const hidden of [{ post_status: "draft" }, { post_status: "private" }, { post_password: "protected" }, { post_type: "page" }]) {
    const unavailable = render("blog", { ...article, editorialPosts: [{ ...publicPost, ...hidden }] });
    assert.match(unavailable, /Contenu indisponible/);
    assert.doesNotMatch(unavailable, /Exemple de publication locale/);
  }
  const category = render("blog", { editorialPosts: [publicPost], query: { rubrique: "publication", pageno: "2" } });
  assert.match(category, /href="https:\/\/inrcy\.com\/basique\/blog\/\?article=432"/);
  assert.match(category, /\/basique\/blog\/\?rubrique=publication&amp;pageno=3/);
});

test("admin capabilities/nonces fail closed; locks recover crashed workers conservatively and preview view accepts only enum strings", () => {
  for (const options of [{}, { admin: true }]) {
    const denied = phpJson("admin-denial", options);
    assert.equal(Object.keys(denied.errors).length, 2); assert.equal(denied.inserts, 0); assert.equal(denied.optionWrites, 0);
  }
  assert.deepEqual(phpJson("locking"), { firstAcquired: true, secondRejected: true, wrongReleaseRejected: true, replacementPreserved: true, staleRecovered: true });
  for (const bad of [[], { nested: "signup" }, "../../private", "unknown"]) {
    assert.equal(phpJson("view", { admin: true, query: { inrcy_basic_preview: "1", _wpnonce: "synthetic-inrcy_basic_site_preview", inrcy_basic_view: bad } }).view, "home");
  }
  assert.equal(phpJson("view", { query: { inrcy_basic_preview: "1", _wpnonce: "synthetic-inrcy_basic_site_preview", inrcy_basic_view: "signup" } }).preview, false);
});

test("actual PHP posts a whitelisted direct body to fixed HTTPS/header and strips backend extras", () => {
  const result = submit(successful);
  assert.equal(result.status, 200); assert.equal(result.remoteCalls.length, 1);
  const remote = result.remoteCalls[0];
  assert.equal(remote.url, "https://app.inrcy.com/api/public/basic-signup");
  assert.equal(remote.options.redirection, 0);
  assert.equal(remote.options.headers["x-trial-signup-secret"], "synthetic-local-token-never-valid-in-production");
  const body = JSON.parse(remote.options.body);
  assert.equal(body.signup_mode, "direct_basic"); assert.equal(body.source, "wordpress-basique");
  assert.equal(body.meta_tracking_consent, "true"); assert.equal(body.utm_campaign, "local-test"); assert.equal(body.untrusted, undefined);
  assert.equal(result.response.data.inrcy_signup_access.ignored, undefined);
  assert.doesNotMatch(JSON.stringify(result.response), /synthetic-local-token|never-public/);
  const denied = submit(successful, { post: { ...post, nonce: "expired" } });
  assert.equal(denied.status, 403); assert.equal(denied.remoteCalls.length, 0);
});

test("actual PHP rejects old/trial/foreign/malformed receipts without transmitting credentials; empty ticket retains manual access", () => {
  for (const body of [
    { ...successful, direct_signup: false }, { ...successful, activation_required: false },
    { ...successful, trial_days: 21 }, { ...successful, trial_end_at: "2099-01-01" },
    { ...successful, trial_end_at: undefined }, { ...successful, trial_days: "0" },
    { ...successful, signup_access: { ...access, email: "different@example.invalid" } },
    { ...successful, signup_access: { ...access, login_url: "https://example.invalid/steal" } },
  ]) {
    const result = submit(body);
    assert.equal(result.status, 502); assert.equal(result.response.success, false);
    assert.doesNotMatch(JSON.stringify(result.response), /Synthetic!Password|synthetic-private-ticket/);
  }
  assert.equal(submit({ ...successful, signup_access: { ...access, ticket: "" } }).response.data.inrcy_signup_access.ticket, "");
});

test("scoped SEO replaces general metadata/schema, emits Basic canonicals, and leaves disabled root untouched", () => {
  for (const view of Object.keys(pages) as View[]) {
    const seo = phpJson("seo", {}, view);
    assert.equal(seo.rankCanonical, "https://inrcy.com" + pages[view]);
    assert.equal(seo.rankTitle, seo.meta.title); assert.equal(seo.rankSocial, seo.meta.description); assert.deepEqual(seo.rankSchema, []);
    assert.doesNotMatch(JSON.stringify(seo), /21\s*jours|période d[’']essai|essai gratuit/i);
    if (view === "home") assert.equal(seo.schema["@graph"][2].offers.price, 29);
    if (view === "faq") assert.equal(seo.schema["@graph"][2].mainEntity.length, phpJson("catalogue").faq.length);
  }
  assert.equal(phpJson("seo", legacyOptions).rankTitle, "Ancienne offre générale de test");
  const preview = render("home", { admin: true, preview: true });
  assert.match(preview, /inrcy_basic_view=terms/);
  assert.match(preview, /inrcy_basic_view=privacy/);
  assert.doesNotMatch(preview, /href="\/basique\/(?:conditions|confidentialite)\/"/);
  assert.match(preview, /name="robots" content="noindex,nofollow"/);
  assert.match(preview, /rel="canonical" href="https:\/\/inrcy.com\/basique\/"/);
});
