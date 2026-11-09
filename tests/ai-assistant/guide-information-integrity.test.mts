import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isDashboardDestinationAllowedForEdition } from "../../lib/dashboardEdition.ts";
import { INR_ASSISTANT_CREATION_GUIDES } from "../../lib/inrAssistantGuidesCreation.ts";
import { INR_ASSISTANT_MANAGEMENT_GUIDES } from "../../lib/inrAssistantGuidesManagement.ts";
import { getProductNavigation } from "../../lib/productNavigation.ts";
import { INR_ASSISTANT_RECOVERY_GUIDES } from "../../lib/inrAssistantGuidesRecovery.ts";

const root = new URL("../../", import.meta.url);
const guides = [...INR_ASSISTANT_CREATION_GUIDES, ...INR_ASSISTANT_MANAGEMENT_GUIDES];
const guide = (id: string) => guides.find(item => item.id === id)!;

test("manual tool guides agree with the native Basic access gates", () => {
  for (const [id, navigationId] of [["booster", "publish"], ["studio-create", "studio"], ["studio-edit", "studio"], ["media-library", "media"], ["stats", "stats"], ["send", "send"], ["reputation", "reviews"]]) {
    const navigation = getProductNavigation(navigationId!)!;
    assert.equal(isDashboardDestinationAllowedForEdition(navigation.href, "basic"), true, id);
    assert.match(guide(id!).content, /Basique/, id);
    assert.doesNotMatch(guide(id!).content, /Accès : Standard et Premium|Accès : Standard \(essai inclus\) et Premium/, id);
  }
  assert.match(guide("studio-create").content, /recharges permettent de générer sans changer d’offre/);
  assert.match(guide("stats").content, /Basique.*sans génération\/envoi d’un nouveau bilan/);
});

test("Premium and accounting guidance retains the real native restrictions", () => {
  for (const [id, navigationId] of [["crm", "crm"], ["calendar", "calendar"], ["ads", "ads"], ["emailing", "campaigns"]]) {
    // Campaigns opens a selector on the dashboard; the selected native tool
    // carries the Premium gate, as in dashboardMobileMenuModel.
    const href = id === "emailing" ? "/dashboard/propulser" : getProductNavigation(navigationId!)!.href;
    assert.equal(isDashboardDestinationAllowedForEdition(href, "basic"), false, id);
    assert.equal(isDashboardDestinationAllowedForEdition(href, "standard"), false, id);
    assert.equal(isDashboardDestinationAllowedForEdition(href, "premium"), true, id);
    assert.match(guide(id!).content, /Premium/, id);
  }
  for (const id of ["quotes", "invoices"]) {
    assert.equal(isDashboardDestinationAllowedForEdition(getProductNavigation(id)!.href, "premium"), false);
    assert.match(guide(id).content, /droits comptables/);
  }
});

test("review knowledge follows the real Google bubble and identifies the actual assistant tools", () => {
  const reviews = guide("reputation");
  const workspace = readFileSync(new URL("app/dashboard/_components/DashboardChannelWorkspace.tsx", root), "utf8");
  const tools = readFileSync(new URL("lib/inrAssistantInsightsTools.ts", root), "utf8");
  assert.match(workspace, /extraActions: gmb\.gmbConfigured/);
  assert.match(workspace, /onClick=\{\(\) => setReviewsOpen\(true\)\}/);
  assert.match(reviews.content, /Connecter mes canaux → Google Business → Avis/);
  assert.match(reviews.content, /\/dashboard\?panel=gmb&googleReviews=1/);
  assert.doesNotMatch(reviews.content, /Menu\s*>\s*«\s*Réputation|Accueil\s*>\s*«\s*Gérer|Gérer Google|Brancher Google|action=recolter/);
  for (const name of ["readGoogleReviews", "replyToGoogleReview"]) {
    assert.ok(tools.includes(`${name}: tool(`));
    assert.ok(reviews.content.includes(name));
  }
  assert.match(reviews.content, /ordre explicite actuel/);
  assert.match(reviews.content, /Préparer un texte ne publie rien/);
});

test("onboarding separates business personalization from the account panel", () => {
  const start = INR_ASSISTANT_RECOVERY_GUIDES.find(item => item.id === "getting-started-autonomously")!;
  assert.match(start.content, /Personnaliser \(\/dashboard\/personnalisation\)/);
  assert.match(start.content, /Mon entreprise.*Ma communication/);
  assert.match(start.content, /Mon compte gère la connexion, l’abonnement et les préférences, pas le profil/);
});
