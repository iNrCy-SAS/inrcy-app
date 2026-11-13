import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as React from "react";
import { chromium } from "@playwright/test";
import { responsiveSurfaceFixture } from "../helpers/responsive-surface-fixture.mts";

const noop = () => {};
type Surface = { name: string; html: string; touchSelectors: string[]; minimum?: number };

function surfaces(locale: string): Surface[] {
  const fixture = responsiveSurfaceFixture(locale);
  const mails = fixture.stylesheet("app/dashboard/mails/mails.module.css");
  const crm = fixture.stylesheet("app/dashboard/crm/crm.module.css");
  const agenda = fixture.stylesheet("app/dashboard/agenda/agenda.module.css");
  const stats = fixture.stylesheet("app/dashboard/stats/statsPanorama.module.css");
  const reviews = fixture.stylesheet("app/dashboard/e-reputation/eReputation.module.css");
  const media = fixture.stylesheet("app/dashboard/_components/MediaGenerator.module.css");
  const reference = fixture.stylesheet("app/dashboard/_components/MediaReferenceInputs.module.css");
  const cta = fixture.stylesheet("app/dashboard/settings/_components/AiChannelCtaPanel.module.css");
  const sequence = fixture.stylesheet("app/dashboard/_components/DetailSequenceNavigation.module.css");
  const documents = fixture.stylesheet("app/dashboard/_documents/documents.module.css");
  const guide = fixture.stylesheet("app/dashboard/_components/DashboardUsageGuide.module.css");
  const contact = { id: "contact", display_name: locale === "de-DE" ? "Ein Kontakt mit einem sehr langen Unternehmensnamen" : "Un contact avec un nom d’entreprise très long", first_name: "Camille", last_name: "Exemple", email: "contact@example.test", phone: "0102030405", address: "12 rue Exemple", city: "Paris", postal_code: "75001", category: "professionnel", contact_type: "client", notes: "", important: false };
  const wrap = (children: React.ReactNode, className?: string) => React.createElement("div", { className, style: { minWidth: 0, padding: 12 } }, children);
  const mailbox = fixture.element("app/dashboard/mails/_components/MailboxToolbar.tsx", {
    folder: "mails", filterAccountId: "", setFilterAccountId: noop, mailAccounts: [{ id: "mail", display_name: "Service commercial", email_address: "contact@example.test", provider: "imap" }], searchOpen: true, historyQuery: "Camille", setSearchOpen: noop, loadHistory: noop,
    toolCfg: { label: locale === "de-DE" ? "Eine neue Nachricht verfassen" : "Rédiger un nouveau message" }, resetCompose: noop, setComposeOpen: noop, boxView: "drafts", onBoxViewChange: noop, draftCount: 123,
  });
  const search = fixture.element("app/dashboard/mails/_components/MailboxSearchPanel.tsx", { open: true, value: "Camille", inputRef: { current: null }, onChange: noop, onClose: noop, onClear: noop });
  const mailboxList = fixture.element("app/dashboard/mails/_components/MailboxList.tsx", { folder: "mails", boxView: "sent", loading: false, visibleItems: [], selectedId: null, openItem: noop, openDetails: noop, mailAccounts: [], itemMailAccountId: () => null, filteredItemsLength: 0, historyPage: 123, historyTotalCount: 99999, historyHasMorePotential: true, historyPageCount: 5000, loadHistory: noop, refreshHistory: noop, historyQuery: "" });
  const crmView = fixture.element("app/dashboard/crm/_components/CRMContactsView.tsx", {
    documentsEnabled: true, isResponsive: true, visibleContacts: [contact], emptyMessage: "", selectedContactIds: new Set(), expandedMobileContactId: "contact", setExpandedMobileContactId: noop, toggleSelect: noop, sendMailToContact: noop, goPlanifierIntervention: noop, goNewDevis: noop, goNewFacture: noop, startEdit: noop, toggleImportant: noop, remove: noop, mobileLoadMoreRef: { current: null }, loading: false, page: 1, mobileHasMore: false, allVisibleSelected: false, toggleSelectAllVisible: noop, showDesktopEmptyMessage: false, desktopRowHeight: 50, desktopPlaceholderRows: [],
  });
  const agendaProps: Record<string, unknown> = { open: true, rdvMode: "request", rdvKind: "agenda", rdvIsDraft: false, rdvSaving: false, rdvError: null, rdvSummary: locale === "de-DE" ? "Ein Kundentermin mit einem langen Betreff" : "Un rendez-vous client avec un titre long", rdvDate: "2026-11-20", rdvStart: "09:00", rdvEnd: "10:00", intStatus: "confirmé", contacts: [], startTimeOptions: ["09:00", "10:00"], endTimeOptions: ["10:00", "11:00"], rdvGuests: [], rdvRemindersEnabled: false, rdvRemindersAvailable: true, requestIndex: 1, requestCount: 20, navigationLabel: "", canNavigatePrevious: true, canNavigateNext: true, contactsLoading: false };
  for (const name of ["rdvLocation", "rdvNotes", "intType", "intReference", "rdvContactId", "rdvNewContactName", "rdvNewContactEmail", "rdvNewContactPhone", "rdvNewContactAddress", "rdvNewContactCity", "rdvNewContactPostal", "rdvNewContactSiren", "rdvNewContactCategory", "rdvNewContactType", "rdvNewContactNotes", "crmAddFeedback"]) agendaProps[name] = "";
  for (const name of ["onClose", "onPreviousRequest", "onNextRequest", "onNavigatePrevious", "onNavigateNext", "onDelete", "onSubmit", "onSaveDraft", "onRejectRequest", "onAddContactToCrm", "onAddGuest", "onRemoveGuest", "onUpdateGuestContactId", "onUpdateGuestField", "clearCrmAddFeedback", "setRdvKind", "setRdvSummary", "setRdvDate", "setRdvStart", "setRdvEnd", "setRdvLocation", "setRdvNotes", "setIntType", "setIntStatus", "setIntReference", "setRdvContactId", "setRdvNewContactName", "setRdvNewContactEmail", "setRdvNewContactPhone", "setRdvNewContactAddress", "setRdvNewContactCity", "setRdvNewContactPostal", "setRdvNewContactSiren", "setRdvNewContactCategory", "setRdvNewContactType", "setRdvNewContactImportant", "setRdvNewContactNotes", "setRdvRemindersEnabled"]) agendaProps[name] = noop;
  const event = fixture.element("app/dashboard/agenda/agenda.ui.tsx", agendaProps, "AgendaEventModal");
  const editEvent = fixture.element("app/dashboard/agenda/agenda.ui.tsx", { ...agendaProps, rdvMode: "edit", navigationLabel: "123 / 999" }, "AgendaEventModal");
  const navigator = fixture.element("app/dashboard/stats/StatsViewNavigator.tsx", { pages: [{ key: "all", title: locale === "de-DE" ? "Gesamtübersicht Ihrer Geschäftskontakte" : "Vue globale des contacts professionnels" }, { key: "evolution", title: "Évolution" }, { key: "facebook", title: "Facebook" }], activeKey: "all", onSelect: noop });
  const overview = fixture.element("app/dashboard/stats/StatsOverview.tsx", { ready: true, connectedCount: "1/1", onOpenChannel: noop, onRunAction: noop, channels: [{ key: "facebook", title: "Facebook", subtitle: "Compte professionnel", accountLabel: "Service commercial", iconSrc: "/facebook.png", status: "connected", opportunities: "123", opportunityValue: 123, visibilityValue: 100, revenue: "12 345 €", actionLabel: locale === "de-DE" ? "Eine Veröffentlichung vorbereiten" : "Préparer une publication", actionTitle: "Publication", actionHref: "/dashboard/booster", premiumLocked: false }] });
  // Exact review-pagination structure from EReputationReviewsClient; no review/account API.
  const pagination = React.createElement("div", { className: reviews.paginationControls, "aria-label": fixture.t("reputation")("pagination_des_avis_49f33c6b") },
    ["‹", "1", "2", "3", "…", "8", "›"].map((label, index) => React.createElement(label === "…" ? "span" : "button", { key: index, className: label === "…" ? reviews.paginationEllipsis : label === "2" ? reviews.paginationActive : /[‹›]/.test(label) ? reviews.paginationArrow : reviews.paginationPage, type: label === "…" ? undefined : "button" }, label)));
  const references = fixture.element("app/dashboard/_components/MediaReferenceInputs.tsx", { references: [{ id: "first", name: "Photo professionnelle avec un nom de fichier long.jpg", previewUrl: "/fixture-first.jpg", role: "character" }, { id: "second", name: "Photo suivante.jpg", previewUrl: "/fixture-second.jpg", role: "environment" }], accept: "image/*", compact: true, information: "Informations sur les images de référence", onFiles: noop, onLibrary: noop, onRemove: noop, onRole: noop, onUsage: noop });
  const ctaPanel = React.createElement("div", { "data-personalization-configuration": "true" }, fixture.element("app/dashboard/settings/_components/AiChannelCtaPanel.tsx", { value: {}, onChange: noop }));
  const documentProps: Record<string, unknown> = { crmContainerRef: { current: null }, crmLoading: false, crmOpen: true, crmButtonText: locale === "de-DE" ? "Einen Kontakt aus dem CRM auswählen" : "Choisir un contact dans le CRM", crmQuery: "", filteredCrmContacts: [contact], getContactLabel: () => contact.display_name, clientType: "professionnel", fieldErrors: {}, addingToCrm: false, addToCrmDisabled: false, crmActionMessage: null, crmError: null, sameAddresses: true, editingLocked: false };
  for (const name of ["clientName", "clientEmail", "clientSiren", "clientVatNumber", "billingAddress", "billingPostalCode", "billingCity", "deliveryAddress", "deliveryPostalCode", "deliveryCity"]) documentProps[name] = "";
  for (const name of ["onToggleCrm", "onCrmQueryChange", "onSelectCrmContact", "onClientTypeChange", "onAddCurrentClientToCrm", "onClientNameChange", "onClientEmailChange", "onClientSirenChange", "onClientVatNumberChange", "onBillingAddressChange", "onBillingPostalCodeChange", "onBillingCityChange", "onSameAddressesChange", "onDeliveryAddressChange", "onDeliveryPostalCodeChange", "onDeliveryCityChange"]) documentProps[name] = noop;
  const documentContact = fixture.element("app/dashboard/_documents/DocumentContactSection.tsx", documentProps, "DocumentContactSection");
  const usageGuide = fixture.element("app/dashboard/_components/DashboardUsageGuide.tsx", { edition: "founder", metaPilotEnabled: true, inrAgentEnabled: true, progress: { channels: 60, dna: 100, ai: 80, connected: 6, total: 11, uiBalance: 8, isActive: true }, onNavigate: noop });
  const pending = [
    { name: "mails-toolbar-search", node: wrap(React.createElement(React.Fragment, null, mailbox, search)), touchSelectors: [`.${mails.toolbarBtn}`, `.${mails.searchClearBtn}`, `.${mails.searchCloseBtn}`] },
    { name: "mails-list-pagination", node: wrap(mailboxList), touchSelectors: [`.${mails.listFooterArrowButton}`, `.${mails.listFooterRefreshButton}`] },
    { name: "crm-contact-actions", node: wrap(crmView), touchSelectors: [`.${crm.mobileExpandBtn}`, `.${crm.mobileCheckboxWrap}`, `.${crm.mobileDetailActions} button`] },
    { name: "agenda-request-form", node: event, touchSelectors: [`.${agenda.requestSwitchButton}`, `.${agenda.dateInputIcon}`] },
    { name: "stats-panorama", node: wrap(React.createElement(React.Fragment, null, navigator, overview)), touchSelectors: [`.${stats.channelAction}`] },
    { name: "reviews-pagination", node: wrap(pagination), touchSelectors: [`.${reviews.paginationControls} button`] },
    { name: "studio-reference-inputs", node: wrap(references), touchSelectors: [`.${reference.root} button`, `.${reference.tileControls} select`, `.${media.referenceDropzoneActions} label`, `.${reference.root} summary`] },
    { name: "settings-channel-cta", node: wrap(ctaPanel), touchSelectors: [`.${cta.navArrow}`] },
    { name: "agenda-edit-navigation", node: editEvent, touchSelectors: [`.${sequence.button}`] },
    { name: "document-contact-form", node: wrap(documentContact), touchSelectors: [`.${documents.checkboxLabel}`] },
    { name: "gps-unified-help", node: wrap(usageGuide), touchSelectors: [`.${guide.toolButton}`] },
  ];
  return pending.map(({ node, ...surface }) => ({ ...surface, html: fixture.markup(node) }));
}

test("targeted mobile controls remain usable and inside the viewport across real French and German views", async t => {
  const browser = await chromium.launch({ headless: true });
  const records: unknown[] = [], failures: string[] = [];
  try {
    for (const locale of ["fr-FR", "de-DE"]) {
      for (const surface of surfaces(locale)) {
        const page = await browser.newPage();
        await page.route("**/*", route => route.abort());
        for (const viewport of [{ width: 320, height: 740 }, { width: 360, height: 740 }, { width: 390, height: 740 }, { width: 768, height: 800 }, { width: 1093, height: 614 }, { width: 1101, height: 700 }, { width: 1366, height: 700 }]) {
          await page.setViewportSize(viewport);
          await page.setContent(surface.html);
          const geometry = await page.evaluate(selectors => {
            const controls = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
            return { pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, controls: controls.map(element => { const r = element.getBoundingClientRect(); return { label: element.getAttribute("aria-label") || element.textContent?.trim(), width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, clipped: (() => { let p = element.parentElement; while (p && p.tagName !== "BODY") { const s = getComputedStyle(p), b = p.getBoundingClientRect(); if (["hidden", "clip"].includes(s.overflowX) && (r.left < b.left - 1 || r.right > b.right + 1)) return true; p = p.parentElement; } return false; })() }; }) };
          }, surface.touchSelectors);
          const context = `${locale} ${surface.name} ${viewport.width}px`;
          if (geometry.pageOverflow) failures.push(`${context}: horizontal page overflow`);
          for (const control of geometry.controls) {
            if (control.left < -1 || control.right > viewport.width + 1 || control.clipped) failures.push(`${context}: clipped ${control.label}`);
            if (viewport.width <= 1100 && (control.width < 43.5 || control.height < 43.5)) failures.push(`${context}: ${control.label} target ${control.width.toFixed(1)}×${control.height.toFixed(1)}`);
          }
          for (const [index, control] of geometry.controls.entries()) {
            for (const other of geometry.controls.slice(index + 1)) {
              if (Math.min(control.right, other.right) - Math.max(control.left, other.left) > 1 && Math.min(control.bottom, other.bottom) - Math.max(control.top, other.top) > 1) failures.push(`${context}: overlapping ${control.label} / ${other.label}`);
            }
          }
          records.push({ locale, surface: surface.name, ...viewport, ...geometry });
          const directory = process.env.INRCY_LAYOUT_SCREENSHOT_DIR;
          if (directory && locale === "de-DE" && [320, 768, 1366].includes(viewport.width)) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: path.join(directory, `${surface.name}-${viewport.width}.png`) }); }
        }
        await page.close();
      }
    }
    const reportFile = process.env.INRCY_RESPONSIVE_REPORT;
    if (reportFile) writeFileSync(reportFile, JSON.stringify({ records, failures }, null, 2));
    t.diagnostic(`${records.length} actual-component/CSS layouts; account and provider requests disabled.`);
    assert.deepEqual(failures, []);
  } finally { await browser.close(); }
});
