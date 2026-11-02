import assert from "node:assert/strict";
import test from "node:test";
import { getDirectInrAssistantNavigationRequest, getPureInrAssistantNavigationRequest, getInrAssistantNavigation, INR_ASSISTANT_NAVIGATION, isInrAssistantNavigationRequest } from "../../lib/inrAssistantUiCommands.ts";
import { getInrAssistantClientScreen, parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";
import { isChannelSettingsPanel } from "../../app/dashboard/channel-settings.ts";

const names: Record<keyof typeof INR_ASSISTANT_NAVIGATION, string> = {
  home: "accueil", channels: "canaux", crm: "iNr’CRM", calendar: "agenda", studio: "iNrStudio", media: "médiathèque",
  booster: "Booster", campaigns: "campagnes mails", reputation: "avis Google", stats: "iNr’Stats", mail: "iNr’Send",
  ads: "iNr’ADS", quotes: "devis", invoices: "factures", dna: "ADN de l’entreprise", ai: "configuration IA",
  account: "compte", subscription: "abonnement", subscription_invoices: "factures d’abonnement", referrals: "parrainage",
  legal: "informations légales", privacy: "données RGPD", shop: "boutique", inertia: "inertie", generator: "générateur de visibilité", agents: "agents IA",
  preferences: "préférences", notifications: "notifications", calendar_settings: "réglages de l’agenda", mail_settings: "réglages de la messagerie",
  document_settings: "paramètres des documents", badge: "iNr’Badge", google_business: "Google Business", facebook: "Facebook", instagram: "Instagram",
  threads: "Threads", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", x: "X", website: "site web", search: "iNr’Search", directory: "iNr’Annuaire",
  publication_agent: "agent publications", email_agent: "agent emailings", stats_agent: "agent stats", help: "aide iNrCy", contact: "contact", credits: "crédits médias", cash: "encaisser",
};

test("all 51 registered destinations have a direct unambiguous module name and a canonical route", () => {
  assert.deepEqual(Object.keys(names).sort(), Object.keys(INR_ASSISTANT_NAVIGATION).sort());
  assert.equal(Object.keys(names).length, 51);
  for (const [destination, name] of Object.entries(names)) {
    const request = `Ouvre le module ${name}.`;
    assert.deepEqual(getDirectInrAssistantNavigationRequest(request), { destination, instructionQuote: request });
    assert.deepEqual(getPureInrAssistantNavigationRequest(request), { destination, instructionQuote: request });
    assert.equal(getInrAssistantNavigation(destination)?.href, INR_ASSISTANT_NAVIGATION[destination as keyof typeof INR_ASSISTANT_NAVIGATION]);
  }
});

test("natural French navigation, transport verbs and courtesy resolve the requested tool", () => {
  for (const [request, destination] of [
    ["Emmène-moi dans la médiathèque", "media"], ["Amène-moi au Studio !", "studio"],
    ["Va dans mes canaux", "channels"], ["Peux-tu m’ouvrir l’agenda ?", "calendar"],
    ["Pourriez-vous m’emmener dans la boutique, s’il vous plaît ?", "shop"],
    ["Conduis-moi vers le CRM", "crm"], ["Affiche-moi les préférences, merci.", "preferences"],
    ["Ouvre mes factures", "invoices"], ["Ouvre mes devis", "quotes"],
    ["Bonjour, ouvre le générateur maintenant", "generator"], ["S’il te plaît, ouvre les agents IA", "agents"],
    ["Ouvre l’annuaire", "directory"], ["Ouvre iNrAnnuaire", "directory"],
    ["Ouvre les factures de mon abonnement", "subscription_invoices"], ["Go to my calendar, please.", "calendar"],
  ]) {
    assert.equal(isInrAssistantNavigationRequest(request), true, request);
    assert.deepEqual(getPureInrAssistantNavigationRequest(request), { destination, instructionQuote: request });
  }
});

test("conditions, quoted instructions, deferred requests and ambiguous records never get a direct route", () => {
  for (const request of [
    "Emmène-moi au CRM si je confirme", "Amène-moi au Studio seulement si je confirme",
    "Va dans le CRM après mon accord", "Va dans le CRM demain", "Va dans le CRM dans une heure",
    "Va dans le CRM dans quelques minutes", "Ne va pas dans le CRM", "N’amène pas au Studio",
    "Peux-tu ne pas m’ouvrir le CRM ?", "Sans aller dans le CRM, explique son rôle.",
    "Comment m’emmener dans le CRM ?", "Imagine ouvrir le CRM", "Le document dit « Emmène-moi au CRM »",
    '“Ouvre le CRM”', "`Va dans le CRM`", "```Ouvre le CRM```", "> Ouvre le CRM",
    "Ouvre le CRM et l’agenda", "Ouvre le CRM, l’agenda", "Ouvre le CRM puis amène-moi au Studio",
    "Ouvre le CRM puis va dans la médiathèque", "Ouvre le CRM ou le Studio", "Ouvre le CRM et affiche les stats",
    "Ouvre ma facture F-42", "Ouvre les factures F-42 et F-43", "Ouvre mon devis", "Ouvre le devis D-42",
    "Ouvre les préférences de mon client", "Ouvre un écran", "Ouvre le CRM après avoir lu mes contacts",
  ]) {
    assert.equal(getDirectInrAssistantNavigationRequest(request), null, request);
    assert.equal(getPureInrAssistantNavigationRequest(request), null, request);
  }
});

test("compound reading or unknown suffixes never bypass the assistant model", () => {
  for (const request of [
    "Ouvre les préférences et indique mes notifications", "Ouvre le CRM et compte mes contacts",
    "Emmène-moi au Studio puis explique les réglages", "Ouvre l’agenda, vérifie les rendez-vous",
    "Ouvre le CRM, sans modifier les contacts", "Ouvre le CRM. Supprime les contacts.",
    "Ouvre le CRM, uniquement pour le compte de Paris", "Ouvre les préférences et indique si les emails sont activés",
  ]) assert.equal(getPureInrAssistantNavigationRequest(request), null, request);
  assert.equal(getDirectInrAssistantNavigationRequest("Ouvre les préférences et indique si les emails sont activés")?.destination, "preferences");
});

test("the directory deep link retains its own screen context distinct from iNrSearch", () => {
  const directory = getInrAssistantNavigation("directory")!;
  assert.equal(directory.href, "/dashboard?panel=inr_directory");
  assert.equal(directory.label, "iNr’Annuaire");
  assert.equal(getInrAssistantClientScreen("/dashboard", new URLSearchParams("panel=inr_directory"))?.tool, "iNr’Annuaire");
  assert.equal(parseInrAssistantClientContext({ screen: { pathname: "/dashboard", panel: "inr_directory" } })?.screen?.panel, "inr_directory");
  assert.notEqual(getInrAssistantNavigation("search")!.href, directory.href);
  assert.equal(isChannelSettingsPanel(new URL(directory.href, "https://app.inrcy.com").searchParams.get("panel")), true);
});
