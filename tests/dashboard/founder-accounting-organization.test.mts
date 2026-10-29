import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasAccountingDashboardAccess,
  isApiRouteAllowedForEdition,
  isDashboardDestinationAllowedForEdition,
  isDashboardRouteAllowedForEdition,
  resolveDashboardEditionFromPlan,
} from "../../lib/dashboardEdition.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("Founder est la seule édition qui possède Encaisser, Factures et Devis", () => {
  assert.equal(resolveDashboardEditionFromPlan("Founder"), "founder");
  assert.equal(resolveDashboardEditionFromPlan("iNrCy-Founder"), "founder");
  assert.equal(hasAccountingDashboardAccess("standard"), false);
  assert.equal(hasAccountingDashboardAccess("premium"), false);
  assert.equal(hasAccountingDashboardAccess("founder"), true);

  for (const edition of ["standard", "premium"] as const) {
    assert.equal(isDashboardDestinationAllowedForEdition("/dashboard/factures", edition), false);
    assert.equal(isDashboardDestinationAllowedForEdition("/dashboard/devis/new", edition), false);
    assert.equal(
      isDashboardRouteAllowedForEdition("/dashboard", new URLSearchParams("action=cash"), edition),
      false,
    );
    assert.equal(
      isDashboardRouteAllowedForEdition("/dashboard", new URLSearchParams("panel=documents"), edition),
      false,
    );
    assert.equal(isApiRouteAllowedForEdition("/api/documents/settings", undefined, edition), false);
    assert.equal(isApiRouteAllowedForEdition("/api/factures", undefined, edition), false);
    assert.equal(
      isApiRouteAllowedForEdition(
        "/api/inrsend/history",
        new URLSearchParams("folder=factures"),
        edition,
      ),
      false,
    );
  }

  assert.equal(isDashboardDestinationAllowedForEdition("/dashboard/factures", "founder"), true);
  assert.equal(isDashboardDestinationAllowedForEdition("/dashboard/devis/new", "founder"), true);
  assert.equal(
    isDashboardRouteAllowedForEdition("/dashboard", new URLSearchParams("action=cash"), "founder"),
    true,
  );
  assert.equal(isApiRouteAllowedForEdition("/api/documents/settings", undefined, "founder"), true);
  assert.equal(
    isApiRouteAllowedForEdition(
      "/api/inrsend/history",
      new URLSearchParams("folder=devis"),
      "founder",
    ),
    true,
  );
});

test("le cockpit validé conserve Booster distinct, les outils quotidiens et les quatre outils Premium verrouillables", () => {
  const source = read("app/dashboard/_components/DashboardModulesCard.tsx");
  const campaignChoices = read("app/dashboard/_components/DashboardCampaignChoices.tsx");
  const styles = read("app/dashboard/_components/DashboardSignatureTools.module.css");
  const booster = source.indexOf('"premium-booster-publish"');
  const pilot = source.indexOf('id="dashboard-pilot-title"');
  const signatures = source.indexOf("{pilotTools.map");
  const relationships = source.indexOf('data-dashboard-relationship-tools="true"');
  const premium = source.indexOf('id="dashboard-premium-title"');
  const premiumGate = source.indexOf('<fieldset disabled={standardMode}');
  const premiumTools = source.indexOf("{premiumTools.map");

  assert.ok(booster >= 0 && booster < pilot);
  assert.ok(pilot < relationships && relationships < signatures);
  assert.ok(signatures < premium && premium < premiumGate && premiumGate < premiumTools);
  assert.doesNotMatch(source, /signatureStyles\.dnaCard/);

  // Assert the approved arrangement while preserving destinations and rights.
  const signatureDefinitions = source.slice(source.indexOf("const signatureTools:"), source.indexOf("const agentControls ="));
  const signatureNames = Array.from(
    signatureDefinitions.matchAll(/tone: "([^"]+)"/g),
    (match) => match[1],
  );
  assert.deepEqual(signatureNames, ["sendCard", "studioCard", "statsCard", "calendarCard", "crmCard", "adsCard", "campaignCard"]);
  assert.match(signatureDefinitions, /path: standardMode \? "\/dashboard\/mails\?folder=publications&boxView=sent" : "\/dashboard\/mails"/);
  assert.deepEqual([...signatureDefinitions.matchAll(/\{ path: "(\/dashboard[^\"]+)"/g)].map((match) => match[1]), ["/dashboard/stats", "/dashboard/agenda", "/dashboard/crm", "/dashboard/ads", "/dashboard?action=campaigns"]);
  assert.match(source, /className=\{signatureStyles\.signatureGrid\}/);
  assert.doesNotMatch(signatureDefinitions, /tone: "reputationCard"/);
  assert.match(source, /const premiumTools = \["adsCard", "campaignCard", "calendarCard", "crmCard"\]/);
  assert.match(styles, /\.lowerRow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.creationGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.signatureGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.statsCard\s*\{[^}]*grid-column: 1 \/ -1/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.lowerRow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(source, /pilotTools\.map\(renderSignatureTool\)/);
  assert.match(source, /premiumTools\.map\(renderSignatureTool\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.boosterWave\s*\{\s*animation:\s*none/);

  // The visual regrouping must keep the existing tool entry points and access restrictions.
  assert.match(source, /testId: standardMode \? "standard-campaign-mails" : "premium-campaign-open"/);
  assert.match(campaignChoices, /premium-campaign-open/);
  assert.match(source, /startModuleNavigation\("\/dashboard\/propulser"\)/);
  assert.match(source, /startModuleNavigation\("\/dashboard\/fideliser"\)/);
  assert.match(source, /accountingEnabled && cashModalOpen/);
  assert.match(signatureDefinitions, /tone: "adsCard"[^\n]*premiumOnly: true, unavailable: !adsPilotEnabled/);
  assert.match(source, /disabled=\{Boolean\(standardMode && tool\.premiumOnly\) \|\| tool\.unavailable/);
  assert.match(source, /onClick=\{standardMode && tool\.premiumOnly \? \(\) => startPanelOpening\("abonnement"\)/);
  assert.match(source, /if \(onOpenBoosterPublish\) onOpenBoosterPublish\(\)/);
  assert.match(source, /if \(onOpenBoosterStats\) onOpenBoosterStats\(\)/);
  assert.match(source, /testId: standardMode \? "standard-studio-open" : "premium-studio-open"/);
  assert.match(source, /data-testid=\{tool\.testId\}/);
  assert.match(source, /const studioPath = "\/dashboard\/generer-media"/);
  assert.match(source, /const standardMode = standardModeOverride \|\| isStandardDashboardEdition\(dashboardEdition\)/);
  assert.match(source, /mobile-shortcuts\/inrcalendar-bubble\.png/);
  assert.match(source, /mobile-shortcuts\/inrcrm-bubble\.png/);
  assert.match(source, /const calendarLabel = i18nT\("inr_calendar_a9473176"\)\.replace/);
  assert.match(source, /const crmLabel = i18nT\("inr_crm_aa43648a"\)\.replace/);
  assert.match(source, /const sendLabel = i18nT\("inr_send_fd44a9fa"\)\.replace/);
  assert.match(source, /const statsLabel = i18nT\("inr_stats_881d9239"\)\.replace/);
});

test("les onglets iNrSend occupent toute la largeur selon l'édition", () => {
  const mailbox = read("app/dashboard/mails/MailboxClient.tsx");
  const folderTabs = read("app/dashboard/mails/_components/FolderTabs.tsx");
  const mailboxStyles = read("app/dashboard/mails/mails.module.css");

  assert.match(mailbox, /folders=\{visibleFolders\}/);
  assert.match(folderTabs, /--folder-tab-count": folders\.length/);
  assert.match(folderTabs, /\{folders\.map\(\(f\) =>/);
  assert.match(
    mailboxStyles,
    /grid-template-columns:\s*repeat\(var\(--folder-tab-count, 7\), minmax\(0, 1fr\)\)/,
  );
});

test("iNrSend, CRM, menus et GPS masquent la comptabilité hors Founder", () => {
  const mailbox = read("app/dashboard/mails/MailboxClient.tsx");
  const mailboxDetails = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
  const crm = read("app/dashboard/crm/CRMClient.tsx");
  const crmToolbar = read("app/dashboard/crm/_components/CRMToolbar.tsx");
  const crmContacts = read("app/dashboard/crm/_components/CRMContactsView.tsx");
  const userMenu = read("app/dashboard/_components/UserMenu.tsx");
  const responsiveMenu = read("app/dashboard/_components/ResponsiveBottomNav.tsx");
  const gpsPolicy = read("app/dashboard/gps/gpsEditionPolicy.ts");

  assert.match(mailbox, /founderMode[\s\S]*ALL_FOLDERS\.filter/);
  assert.match(mailbox, /candidate !== "factures" && candidate !== "devis"/);
  assert.match(mailbox, /documentsEnabled=\{founderMode\}/);
  assert.match(mailboxDetails, /documentsEnabled \|\| !isAccountingDashboardHref/);
  assert.match(crm, /hasAccountingDashboardAccess\(dashboardEdition\)/);
  assert.match(crmToolbar, /\{documentsEnabled \? \(/);
  assert.match(crmContacts, /\{documentsEnabled \? \(/);
  assert.match(userMenu, /accountingEnabled \? \(/);
  assert.match(responsiveMenu, /getDashboardMobileMenu\(dashboardEdition\)/);
  assert.match(read("app/dashboard/_components/dashboardMobileMenuModel.ts"), /isDashboardDestinationAllowedForEdition/);
  assert.match(gpsPolicy, /FOUNDER_ONLY_SECTION_IDS = new Set\(\["documents"\]\)/);
  assert.match(gpsPolicy, /edition === "founder"/);
});
