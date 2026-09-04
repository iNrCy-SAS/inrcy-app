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

test("la boîte de vitesse Premium expose exactement Booster, iNrAgent, Campagnes et Réputation", () => {
  const source = read("app/dashboard/_components/DashboardModulesCard.tsx");
  const styles = read("app/dashboard/dashboard.module.css");
  const booster = source.indexOf("t.modules.publishTitle");
  const agent = source.indexOf("t.modules.agentTitle");
  const campaigns = source.indexOf("t.modules.campaignsTitle");
  const reputation = source.indexOf("t.modules.reputationTitle");

  assert.ok(booster >= 0 && booster < agent);
  assert.ok(agent < campaigns);
  assert.ok(campaigns < reputation);
  assert.match(source, /startModuleNavigation\("\/dashboard\/propulser"\)/);
  assert.match(source, /startModuleNavigation\("\/dashboard\/fideliser"\)/);
  assert.match(source, /accountingEnabled && cashModalOpen/);
  assert.match(styles, /\.gearBlockCard \.gearGrid\s*\{\s*grid-template-rows:\s*repeat\(4, minmax\(74px, 1fr\)\)/);
  assert.doesNotMatch(styles, /\.gearBlockCard \.gearGrid\s*>\s*\.gearCapsule\s*\{\s*grid-column:\s*auto/);
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
  assert.match(responsiveMenu, /accountingEnabled \? \(/);
  assert.match(gpsPolicy, /FOUNDER_ONLY_SECTION_IDS = new Set\(\["documents"\]\)/);
  assert.match(gpsPolicy, /edition === "founder"/);
});
