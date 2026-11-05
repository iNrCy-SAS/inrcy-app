import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantUiSteps, parseInrAssistantUiSteps, inrAssistantUiStepTool, inrAssistantUiStepAcceptsAction, inrAssistantUiStepResult } from "../../lib/inrAssistantUiTask.ts";
import { parseInrAssistantUiCommand, parseInrAssistantNavigation, getInrAssistantNavigation, getInrAssistantPublicationDraftNavigation } from "../../lib/inrAssistantUiCommands.ts";
import { inrAssistantUiActionsFromToolResult, inrAssistantUiSuccessStatus } from "../../lib/inrAssistantUiActions.ts";
import { getInrAssistantNotificationNavigation } from "../../lib/inrAssistantNotificationNavigation.ts";
const ID = "11111111-1111-4111-8111-111111111111";

test("Basic account UI plans preserve Badge logo hosted invoice notification and resumed publication objectives until their exact browser acknowledgement", () => {
  const cases = [
    { message: "Actualise les couleurs du thème Badge depuis mon logo.", command: "refresh_badge_theme_from_logo", tool: "refreshBadgeThemeFromLogo", result: { uiCommand: { command: "refresh_badge_theme_from_logo", selection: { kind: "channel", id: "inrbadge" }, revision: "native_badge_1" } }, status: "applied" },
    { message: "Ouvre ma dernière facture d’abonnement.", command: "open_subscription_invoice_link", tool: "prepareAccountDocumentDownload", result: { uiCommand: { command: "open_subscription_invoice_link", selection: { kind: "account_document", id: "in_REAL" }, invoiceId: "in_REAL" } }, status: "handed_to_browser" },
    { message: `Ouvre la notification ${ID}.`, command: "openNotificationAction", tool: "openNotificationAction", result: { navigation: getInrAssistantNotificationNavigation(ID, "stats", "native_menu_1") }, status: "applied" },
    { message: `Reprends le brouillon ${ID}.`, command: "navigateApplication", tool: "resumePublicationDraft", result: { navigation: getInrAssistantPublicationDraftNavigation(ID) }, status: "applied" },
  ];
  for (const item of cases) {
    const steps = inrAssistantUiSteps(item.message); assert.equal(steps.length, 1, item.message); const step = steps[0]; assert.equal(step.command, item.command); assert.equal(inrAssistantUiStepTool(step), item.tool); assert.ok(parseInrAssistantUiSteps(steps));
    const actions = inrAssistantUiActionsFromToolResult("native-account", { ok: true, ...item.result }); assert.equal(actions.length, 1); assert.equal(inrAssistantUiStepAcceptsAction(step, actions[0]), true); assert.equal(inrAssistantUiSuccessStatus(actions[0]), item.status);
    const issued = { ...step, actions }; assert.equal(inrAssistantUiStepResult(issued, []).status, "pending"); assert.equal(inrAssistantUiStepResult(issued, [{ actionId: actions[0].id, source: "browser_reported", status: "failed" }]).status, "failed"); assert.equal(inrAssistantUiStepResult(issued, [{ actionId: actions[0].id, source: "browser_reported", status: item.status as "applied" | "handed_to_browser" }]).status, "applied");
    if (item.command === "open_subscription_invoice_link") assert.equal(inrAssistantUiStepResult(issued, [{ actionId: actions[0].id, source: "browser_reported", status: "applied" }]).status, "pending", "A browser handoff is never replaced by a page-loaded claim");
    if (item.tool === "openNotificationAction" || item.tool === "resumePublicationDraft") { const plain = getInrAssistantNavigation("booster")!; assert.equal(inrAssistantUiStepAcceptsAction(step, { id: "wrong", type: "navigate", navigation: plain }), false); }
  }
  const native = getInrAssistantNotificationNavigation(ID, "stats", "native_menu_1")!; assert.equal(parseInrAssistantNavigation({ ...native, href: "/dashboard?panel=compte" }), null); assert.equal(parseInrAssistantNavigation({ ...native, label: "Pay now" }), null);
  assert.equal(parseInrAssistantUiCommand({ command: "refresh_badge_theme_from_logo", selection: { kind: "channel", id: "inrbadge" }, revision: "native_badge_1", primaryColor: "#FF0000" }), null);
  for (const message of ["Comment ouvrir ma facture d’abonnement ?", "N’actualise pas le thème Badge depuis mon logo.", `Lis ceci : 'Ouvre la notification ${ID}.'`, "Ouvre mon brouillon de devis."]) assert.equal(inrAssistantUiSteps(message).length, 0, message);
});

test("Basic rich text plans retain original quoted passages and per-field order through their bounded native selection and acknowledgement", () => {
  const passage = "Notre équipe qualifiée. ".repeat(195).trim(); assert.ok(passage.length > 4000 && passage.length <= 5000);
  const message = `Mets en gras le passage «${passage}» de la description ADN.`;
  const steps = inrAssistantUiSteps(message); assert.equal(steps.length, 1); assert.equal(steps[0].instruction, message); assert.ok(parseInrAssistantUiSteps(steps));
  const actionFor = (field: string, selectionText: string) => inrAssistantUiActionsFromToolResult("rich", { ok: true, uiCommand: { command: "control_local_interface", selection: { kind: "account_document", id: field }, revision: "native_rich_1", operation: "select", value: JSON.stringify({ format: "bold", selectionText, wholeField: false }) } })[0];
  assert.equal(inrAssistantUiStepAcceptsAction(steps[0], actionFor("dna_text_description", passage)), true); assert.equal(inrAssistantUiStepAcceptsAction(steps[0], actionFor("dna_text_description", "Invented content")), false);
  const ordered = inrAssistantUiSteps("Mets en gras «Notre équipe» dans la description ADN, puis mets en gras «Notre mission» dans la mission ADN."); assert.equal(ordered.length, 2); assert.equal(ordered[0].instruction.includes("Notre équipe"), true); assert.equal(ordered[0].instruction.includes("Notre mission"), false); assert.equal(ordered[1].instruction.includes("Notre mission"), true);
  assert.equal(inrAssistantUiStepAcceptsAction(ordered[0], actionFor("dna_text_mission", "Notre mission")), false); assert.equal(inrAssistantUiStepAcceptsAction(ordered[1], actionFor("dna_text_mission", "Notre mission")), true);
  const sameField = inrAssistantUiSteps("Mets en gras «Bilan été» dans la description ADN, puis mets en gras «Budget hiver» dans la description ADN."); assert.equal(sameField.length, 2); assert.ok(parseInrAssistantUiSteps(sameField));
  assert.equal(inrAssistantUiStepAcceptsAction(sameField[0], actionFor("dna_text_description", "Budget hiver")), false); assert.equal(inrAssistantUiStepAcceptsAction(sameField[1], actionFor("dna_text_description", "Budget hiver")), true); assert.equal(inrAssistantUiStepAcceptsAction(sameField[1], actionFor("dna_text_description", "Bilan été")), false);
  assert.equal(parseInrAssistantUiSteps([{ ...steps[0], instruction: "Mets en gras toute la description ADN. " + "x".repeat(6200) }]), null);
});
