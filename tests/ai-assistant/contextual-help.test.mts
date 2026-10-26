import assert from "node:assert/strict";
import test from "node:test";
import { getInrAssistantContextualHelp } from "../../lib/inrAssistantContextualHelp.ts";
import { getInrAssistantClientScreen, type InrAssistantClientScreen } from "../../lib/inrAssistantClientContext.ts";

function screen(path: string, query = "") { return getInrAssistantClientScreen(path, new URLSearchParams(query)); }
const routes = [
  ["/dashboard", "action=publish", "Booster"], ["/dashboard/generer-media", "", "iNr’Studio"], ["/dashboard/mediatheque", "", "Mes médias"],
  ["/dashboard/stats", "", "iNr’Stats"], ["/dashboard/ads", "", "iNr’ADS"], ["/dashboard/propulser", "", "Propulser"], ["/dashboard/fideliser", "", "Fidéliser"],
  ["/dashboard", "action=campaigns", "Campagnes mails"], ["/dashboard/mails", "", "iNr’Send"], ["/dashboard/crm", "", "iNr’CRM"], ["/dashboard/agenda", "", "iNr’Calendar"],
  ["/dashboard/adn-entreprise", "", "ADN de l’entreprise"], ["/dashboard/configuration-ia", "", "Configuration IA"], ["/dashboard", "action=channels", "Mes canaux"],
  ["/dashboard", "panel=compte", "Mon compte"], ["/dashboard", "panel=abonnement", "Mon abonnement"], ["/dashboard/e-reputation", "", "Réputation"],
  ["/dashboard/agent", "", "Agents IA"], ["/dashboard/agent/publications", "", "Agent Publications"], ["/dashboard/agent/stats", "", "Agent Stats"], ["/dashboard/agent/campagnes-mails", "", "Agent Emailings"],
  ["/dashboard/devis/new", "", "Mes devis"], ["/dashboard/factures/new", "", "Mes factures"], ["/dashboard", "panel=documents", "Devis et factures"], ["/dashboard/boutique/recharges", "", "Boutique"],
] as const;

test("reviewed tools have three short French and English suggestions with no technical links or invented execution", () => {
  for (const [path, query, tool] of routes) {
    const current = screen(path, query); assert.ok(current, path);
    const french = getInrAssistantContextualHelp(current, "fr-FR");
    const english = getInrAssistantContextualHelp(current, "en-GB");
    assert.equal(french?.tool, tool, path); assert.ok(english?.tool);
    for (const result of [french!, english!]) {
      assert.equal(result.suggestions.length, 3); assert.equal(new Set(result.suggestions).size, 3);
      assert.ok(result.suggestions.every(suggestion => suggestion.length >= 12 && suggestion.length <= 100));
      assert.doesNotMatch(JSON.stringify(result), /https?:|\/dashboard|\/api|accountId|requestId|Supabase|Vercel|token|quota|"(?:status|agent|event)"\s*:/);
    }
    assert.notDeepEqual(french?.suggestions, english?.suggestions);
  }
});

test("home, unknown screens, administrator paths and unsupported locales keep the current generic help", () => {
  for (const current of [undefined, screen("/dashboard"), { pathname: "/dashboard/admin", tool: "iNr’Stats" }, { pathname: "https://evil.test/dashboard", tool: "Booster" }, { pathname: "/dashboard/unavailable", tool: "Mes médias" }]) assert.equal(getInrAssistantContextualHelp(current, "fr-FR"), null);
  for (const locale of ["es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN", "unknown", ""]) assert.equal(getInrAssistantContextualHelp(screen("/dashboard/stats"), locale), null);
});

test("browser titles, private fields and unknown actions cannot invent tool-specific help or leak data", () => {
  const malicious = { pathname: "/dashboard/stats", tool: "PRIVATE_BEARER_TOKEN", accountId: "PRIVATE_ACCOUNT", action: "delete_everything", url: "https://PRIVATE_URL", message: "PRIVATE_MESSAGE" } as InrAssistantClientScreen;
  const result = getInrAssistantContextualHelp(malicious, "fr-FR");
  assert.equal(result?.tool, "iNr’Stats"); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|delete_everything/);
  assert.equal(getInrAssistantContextualHelp({ pathname: "/dashboard", tool: "iNr’Stats" }, "fr-FR"), null);
});

test("aliases, panels and dashboard actions follow the same canonical tool as the actual navigation", () => {
  for (const [left, right] of [
    [screen("/dashboard/interventions"), screen("/dashboard/agenda")],
    [screen("/dashboard/mon-profil"), screen("/dashboard/adn-entreprise")],
    [screen("/dashboard/settings/profil"), screen("/dashboard/adn-entreprise")],
    [screen("/dashboard", "panel=ia"), screen("/dashboard/configuration-ia")],
    [screen("/dashboard", "panel=facebook"), screen("/dashboard", "action=channels")],
    [screen("/dashboard/settings/abonnement"), screen("/dashboard", "panel=abonnement")],
    [screen("/dashboard/booster/publier"), screen("/dashboard", "action=publish")],
  ]) assert.deepEqual(getInrAssistantContextualHelp(left, "fr-FR"), getInrAssistantContextualHelp(right, "fr-FR"));
  assert.deepEqual(getInrAssistantContextualHelp(screen("/dashboard/stats"), " EN_gb "), getInrAssistantContextualHelp(screen("/dashboard/stats"), "en-GB"));
});

test("suggestions stay tool-specific and each call returns independent data without recording collaboration", () => {
  const stats = getInrAssistantContextualHelp(screen("/dashboard/stats"), "fr-FR")!;
  const publications = getInrAssistantContextualHelp(screen("/dashboard", "action=publish"), "fr-FR")!;
  const emails = getInrAssistantContextualHelp(screen("/dashboard/agent/campagnes-mails"), "fr-FR")!;
  assert.match(stats.suggestions.join(" "), /impressions|résultats/);
  assert.match(publications.suggestions.join(" "), /publication|programmer/);
  assert.match(emails.suggestions.join(" "), /campagne|destinataires/);
  assert.deepEqual(Object.keys(stats).sort(), ["suggestions", "tool"]);
  (stats.suggestions as string[])[0] = "PRIVATE_CHANGED_TEXT";
  assert.doesNotMatch(JSON.stringify(getInrAssistantContextualHelp(screen("/dashboard/stats"), "fr-FR")), /PRIVATE_CHANGED_TEXT/);
});
