import assert from "node:assert/strict";
import test from "node:test";
import { getDirectInrAssistantNavigationRequest, getInrAssistantNavigation, INR_ASSISTANT_NAVIGATION_DESTINATIONS, isInrAssistantNavigationRequest, isInrAssistantScreenCommandRequest, parseInrAssistantUiCommand, parseInrAssistantNavigation, parseInrAssistantTaskProgress } from "../../lib/inrAssistantUiCommands.ts";
import { getInrAssistantClientScreen, parseInrAssistantClientContext, selectInrAssistantClientScreen } from "../../lib/inrAssistantClientContext.ts";
import { readInrAssistantResponse } from "../../lib/inrAssistantClientStream.ts";

test("navigation accepts every registered real destination and rejects arbitrary paths and forged results", () => {
  for (const destination of INR_ASSISTANT_NAVIGATION_DESTINATIONS) {
    const result = getInrAssistantNavigation(destination);
    assert.ok(result, destination);
    assert.deepEqual(parseInrAssistantNavigation(result), result);
    assert.equal(parseInrAssistantNavigation({ ...result, href: "/api/delete" }), null);
  }
  for (const value of ["__proto__", "constructor", "/dashboard/crm", "https://attacker.invalid", "admin"]) assert.equal(getInrAssistantNavigation(value), null);
});

test("navigation requires a current request, not quoted, hypothetical or negated content", () => {
  for (const request of ["Ouvre le CRM pour moi", "Peux-tu m’ouvrir l’agenda ?", "Va dans mes canaux", "Open my calendar"]) assert.equal(isInrAssistantNavigationRequest(request), true, request);
  for (const request of ["Comment ouvrir mon CRM ?", "N’ouvre pas le CRM", "Sans ouvrir le CRM, explique-moi son rôle.", "Le fichier contient « ouvre le CRM ».", "```ouvre le CRM```", "Imagine ouvrir le CRM", "Ne montre pas mon agenda.", "Ouvre le CRM seulement si je confirme.", "Ouvre le CRM, si je confirme.", "Open my CRM after my confirmation."]) assert.equal(isInrAssistantNavigationRequest(request), false, request);
});

test("document navigation keeps a canonical owned-record destination without arbitrary URL support", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const result = getInrAssistantNavigation("quotes", id)!;
  assert.equal(result.href, `/dashboard/devis/new?saveId=${id}`);
  assert.deepEqual(parseInrAssistantNavigation(result), result);
  assert.equal(getInrAssistantNavigation("crm", id), null);
  assert.equal(getInrAssistantNavigation("quotes", "../foreign"), null);
  assert.equal(parseInrAssistantNavigation({ ...result, href: "/dashboard/devis/new?saveId=another" }), null);
});

test("direct module opening is distinct from quoted, conditional, ambiguous and record-specific requests", () => {
  for (const [request, destination] of [
    ["Ouvre les préférences de l’application et indique mes notifications sans rien modifier.", "preferences"],
    ["Ouvre les préférences et indique si les emails sont activés.", "preferences"],
    ["Ouvre le module iNr’CRM pour moi.", "crm"], ["Open my calendar", "calendar"],
  ]) assert.deepEqual(getDirectInrAssistantNavigationRequest(request), { destination, instructionQuote: request });
  for (const request of ["Comment ouvrir les préférences ?", "N’ouvre pas mon CRM", "Ouvre le CRM si je confirme", "Ouvre le CRM seulement si je confirme.", "Ouvre le CRM, si je confirme.", "Ouvre le CRM, demain.", "Ouvre le CRM, dans 10 minutes.", "Open my CRM after my confirmation.", "Le document dit « Ouvre le CRM »", "Ouvre ma facture F-42", "Ouvre le CRM puis ouvre mon agenda", "Ouvre les préférences de mon client", "Ouvre un écran"]) {
    assert.equal(getDirectInrAssistantNavigationRequest(request), null, request);
  }
});

test("the selected channel overrides the dashboard route and stale routes never leak into another screen", () => {
  const base = getInrAssistantClientScreen("/dashboard", new URLSearchParams())!;
  const modal = parseInrAssistantClientContext({ screen: { pathname: "/dashboard", action: "channels", channel: "gmb" } })!.screen!;
  assert.equal(selectInrAssistantClientScreen(base, [modal])?.tool, "Mes canaux");
  assert.equal(selectInrAssistantClientScreen(base, [modal])?.channel, "gmb");
  const crm = getInrAssistantClientScreen("/dashboard/crm", new URLSearchParams())!;
  assert.deepEqual(selectInrAssistantClientScreen(crm, [modal]), crm);
});

test("selection context is bounded and never carries form contents or a browser account grant", () => {
  const parsed = parseInrAssistantClientContext({ accountId: "forged", screen: { pathname: "/dashboard/crm", selection: { kind: "contact", id: "contact-123", email: "private@example.invalid" }, pendingChanges: true, form: { password: "private" } } });
  assert.deepEqual(parsed?.screen?.selection, { kind: "contact", id: "contact-123" });
  assert.equal(parsed?.screen?.pendingChanges, true);
  assert.equal(JSON.stringify(parsed).includes("private"), false);
  assert.equal(parsed?.source, "untrusted_client");
  for (const id of ["../other", "https://attacker.invalid", "x".repeat(101)]) assert.equal(parseInrAssistantClientContext({ screen: { pathname: "/dashboard/crm", selection: { kind: "contact", id } } })?.screen?.selection, undefined);
});

test("only bounded server task progress and registered navigation cross the response boundary", async () => {
  const progress = { outcome: "partial", completed: ["Créer le contact"], remaining: ["Préparer le devis"] };
  const navigation = getInrAssistantNavigation("crm");
  const response = await readInrAssistantResponse(Response.json({ message: "Suite", taskProgress: progress, navigation, taskState: { secret: "private" } }), () => {});
  assert.deepEqual(response.payload?.taskProgress, progress);
  assert.deepEqual(response.payload?.navigation, navigation);
  assert.equal(JSON.stringify(response).includes("private"), false);
  assert.equal(parseInrAssistantTaskProgress({ ...progress, completed: ["x".repeat(161)] }), null);
  assert.equal(parseInrAssistantTaskProgress({ ...progress, outcome: "pretend_done" }), null);
});

test("PDF export accepts only a current document command and never an arbitrary click", async () => {
  const command = { command: "export_document_pdf", selection: { kind: "quote", id: "quote-123" } };
  assert.deepEqual(parseInrAssistantUiCommand(command), command);
  for (const invalid of [{ ...command, command: "click_delete" }, { ...command, selection: { kind: "contact", id: "a" } }, { ...command, selection: { kind: "invoice", id: "../../file" } }]) assert.equal(parseInrAssistantUiCommand(invalid), null);
  for (const request of ["Télécharge le PDF de ce devis", "Peux-tu générer le PDF ?", "Export the PDF"]) assert.equal(isInrAssistantScreenCommandRequest(request), true, request);
  for (const request of ["Comment générer un PDF ?", "Ne génère pas le PDF", "Sans exporter le PDF", "Le document dit « télécharge le PDF ».", "```export the PDF```", "Si je génère le PDF, est-ce envoyé ?"]) assert.equal(isInrAssistantScreenCommandRequest(request), false, request);
  const screen = { pathname: "/dashboard/devis/new", selection: command.selection, availableCommands: ["export_document_pdf", "click_delete"] };
  assert.deepEqual(parseInrAssistantClientContext({ screen })?.screen?.availableCommands, ["export_document_pdf"]);
  assert.equal(parseInrAssistantClientContext({ screen: { ...screen, selection: { kind: "contact", id: "a" } } })?.screen?.availableCommands, undefined);
  const response = await readInrAssistantResponse(Response.json({ message: "PDF demandé", uiCommand: command }), () => {});
  assert.deepEqual(response.payload?.uiCommand, command);
});
