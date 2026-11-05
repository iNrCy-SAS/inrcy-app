import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PRODUCT_NAVIGATION, PRODUCT_GOOGLE_REVIEWS_HREF, productNavigationSummary, productNavigationReply } from "../../lib/productNavigation.ts";
import { isDashboardDestinationAllowedForEdition } from "../../lib/dashboardEdition.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("navigation catalogue names existing source screens and unique public destinations", () => {
  assert.equal(new Set(PRODUCT_NAVIGATION.map(entry => entry.id)).size, PRODUCT_NAVIGATION.length);
  for (const entry of PRODUCT_NAVIGATION) {
    assert.ok(entry.steps.length >= 1, entry.id);
    assert.ok(entry.href.startsWith("/dashboard"), entry.id);
    for (const source of entry.sourceFiles) assert.ok(existsSync(resolve(root, source)), `${entry.id}: ${source}`);
    assert.match(productNavigationSummary(entry.id), /Accès actuel/);
    assert.ok(productNavigationReply(entry.id).includes(entry.href), entry.id);
  }
});

test("Google reviews route and assistant next actions use the actual Google Business bubble", () => {
  const path = PRODUCT_NAVIGATION.find(entry => entry.id === "reviews")!;
  assert.deepEqual(path.steps, ["Accueil", "Connecter mes canaux", "Google Business", "Avis"]);
  assert.equal(path.href, "/dashboard?panel=gmb&googleReviews=1");
  assert.match(read("app/dashboard/e-reputation/page.tsx"), /redirect\(PRODUCT_GOOGLE_REVIEWS_HREF\)/);
  assert.match(read("app/dashboard/_components/DashboardChannelWorkspace.tsx"), /extraActions: gmb\.gmbConfigured[\s\S]*?googleReviews[\s\S]*?setReviewsOpen\(true\)/);
  for (const file of ["lib/inrAssistantWorkspaceTools.ts", "lib/inrAssistantInsightsTools.ts"]) {
    const source = read(file);
    assert.match(source, /label: "Avis Google", href: PRODUCT_GOOGLE_REVIEWS_HREF/);
    assert.doesNotMatch(source, /Ouvrir Réputation|dans Réputation|label: "Réputation"/);
  }
  const help = read("app/dashboard/_components/dashboardUsageGuideModel.ts");
  assert.match(help, /tool\("Avis Google", PRODUCT_GOOGLE_REVIEWS_HREF\)/);
  assert.doesNotMatch(productNavigationReply("reviews"), /Menu|Réputation/);
});

test("manual Studio, media and Google review destinations preserve Basique access without Premium leakage", () => {
  for (const id of ["studio", "media", "reviews"] as const) {
    const entry = PRODUCT_NAVIGATION.find(entry => entry.id === id)!;
    assert.equal(isDashboardDestinationAllowedForEdition(entry.href, "basic"), true, id);
  }
  for (const id of ["crm", "calendar", "campaigns", "ads", "invoices", "quotes", "invoices-list", "quotes-list"] as const) {
    const entry = PRODUCT_NAVIGATION.find(entry => entry.id === id)!;
    // The campaigns chooser is a dashboard shell; its actual campaign editor
    // carries the native Premium gate, as in getHelpGoalTools.
    const gatedHref = id === "campaigns" ? "/dashboard/propulser" : entry.href;
    assert.equal(isDashboardDestinationAllowedForEdition(gatedHref, "basic"), false, id);
  }
  assert.match(productNavigationSummary("studio"), /Basique, Standard et Premium/);
  assert.match(productNavigationSummary("studio"), /crédits/);
  assert.equal(PRODUCT_GOOGLE_REVIEWS_HREF, PRODUCT_NAVIGATION.find(entry => entry.id === "reviews")!.href);
});

test("existing client documents link to their lists and keep creation and subscription bills separate", () => {
  for (const [id, href, label, key] of [
    ["invoices-list", "/dashboard/factures", "Mes factures", "mes_factures_f5fd6966"],
    ["quotes-list", "/dashboard/devis", "Mes devis", "mes_devis"],
  ] as const) {
    const entry = PRODUCT_NAVIGATION.find(entry => entry.id === id)!;
    assert.equal(entry.label, label);
    assert.equal(entry.href, href);
    assert.match(productNavigationSummary(id), /directement la liste/);
    assert.match(productNavigationSummary(id), /Droits comptables spécifiques requis/);
    assert.ok(read(`app${href}/page.tsx`).includes(key), id);
    assert.doesNotMatch(entry.steps.join(" → "), /Créer/);
  }
});

test("review help in all supported languages uses the channel bubble instead of the retired menu", () => {
  for (const locale of ["de-DE", "en-GB", "es-ES", "fr-FR", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const messages = JSON.parse(read(`messages/${locale}/dashboard.json`));
    const guide = messages.helpCenter.goals.reviews;
    assert.equal(guide.subtitle, "Google Business", locale);
    assert.ok(guide.steps.step2.includes("Google Business"), locale);
    assert.ok(guide.steps.step2.includes(messages.channelBubble.googleReviews), locale);
    assert.doesNotMatch(guide.steps.step2, /Reputation|Réputation|Reputazione|Reputación|Reputação|Reputatie|声誉|ชื่อเสียง/, locale);
  }
});
