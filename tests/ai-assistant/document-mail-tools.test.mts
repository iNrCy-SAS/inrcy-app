import * as mailLifecycle from "../../lib/inrAssistantMailLifecycle.ts";
import * as adsCommands from "../../lib/inrAssistantAdsUiCommands.ts";
import * as mediaCommands from "../../lib/inrAssistantMediaUiCommands.ts";
import * as mailAttachments from "../../lib/inrAssistantMailAttachments.ts";
import * as websiteCommands from "../../lib/inrAssistantWebsiteUiCommands.ts";
import * as studioCommands from "../../lib/inrAssistantStudioUiCommands.ts";
import * as statsCommands from "../../lib/inrAssistantStatsUiCommands.ts";
import * as badgeCommands from "../../lib/inrAssistantBadgeUiCommands.ts";
import * as screenPolicy from "../../lib/inrAssistantScreenCommandPolicy.ts";
import * as dashboardEditions from "../../lib/dashboardEdition.ts";
import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as commands from "../../lib/inrAssistantUiCommands.ts";
import * as documentCommands from "../../lib/inrAssistantDocumentUiCommands.ts";
import * as clauses from "../../lib/inrAssistantActionClause.ts";
import { parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";
import type * as UiRuntime from "../../lib/inrAssistantUiTools.ts";
import type * as MailRuntime from "../../lib/inrAssistantDocumentMailTools.ts";

const ID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const VERSION = "2026-11-02T12:00:00.000Z", recipient = "alice@example.test";
const message = `Prépare un mail à ${recipient} avec le PDF de cette facture, sans l’envoyer.`;
type Row = Record<string, unknown>;
function harness(options: { message?: string; auth?: boolean; account?: string; edition?: string; subscription?: boolean; expired?: boolean; expireAfterRead?: boolean; row?: Row; payload?: Row; screen?: Row; readError?: boolean } = {}) {
  let reads = 0;
  const document = { id: ID, user_id: "account-A", type: "facture", updated_at: VERSION,
    payload: { number: "FAC-2026-001", isFinalized: true, isTemplate: false, ...options.payload }, ...options.row };
  const db = { from(table: string) {
    assert.equal(table, "doc_saves"); const filters: Row = {};
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() {
      reads++; assert.deepEqual(filters, { user_id: "account-A", type: "facture", id: ID }); return { data: document, error: options.readError ? { message: "fixture" } : null };
    } }; return query;
  } } as unknown as Parameters<typeof UiRuntime.createInrAssistantUiTools>[0]["supabase"];
  const deps: Record<string, unknown> = {
    "./inrAssistantStudioUiCommands.ts": studioCommands, "./inrAssistantStatsUiCommands.ts": statsCommands, "./inrAssistantBadgeUiCommands.ts": badgeCommands,
    "./inrAssistantScreenCommandPolicy.ts": screenPolicy, "./dashboardEdition.ts": dashboardEditions,
    "./inrAssistantWebsiteUiCommands.ts": websiteCommands,
    "./inrAssistantRequestClauses.ts": requestClauses,
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.account ?? "account-A", errorResponse: options.auth === false ? {} : null }) },
    "./dashboardEditionServer": { getDashboardEditionForAccountId: async () => options.edition ?? "founder" },
    "./accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async () => new Set(options.subscription === false ? [] : ["account-A"]) },
    "./inrAssistantUiCommands.ts": commands, "./inrAssistantDocumentUiCommands.ts": documentCommands, "./inrAssistantActionClause.ts": clauses,
    "./inrAssistantAdsUiCommands.ts": adsCommands, "./inrAssistantMailLifecycle.ts": mailLifecycle, "./inrAssistantMediaUiCommands.ts": mediaCommands, "./inrAssistantMailAttachments.ts": mailAttachments,
  };
  function load<T>(name: string): T {
    const source = ts.transpileModule(readFileSync(new URL(`../../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} as T };
    new Function("require", "module", "exports", source)((name: string) => { assert.ok(name in deps, name); return deps[name]; }, mod, mod.exports); return mod.exports;
  }
  deps["./inrAssistantDocumentMailTools"] = load<typeof MailRuntime>("inrAssistantDocumentMailTools");
  deps["./inrAssistantMediaUiTools.ts"] = load("inrAssistantMediaUiTools");
  deps["./inrAssistantAdsUiTools.ts"] = load("inrAssistantAdsUiTools");
  for (const name of ["inrAssistantWebsiteUiTools", "inrAssistantStudioUiTools", "inrAssistantStatsUiTools", "inrAssistantBadgeUiTools"]) deps[`./${name}.ts`] = load(name);
  const screen = { pathname: "/dashboard/factures/new", tool: "Factures", selection: { kind: "invoice", id: ID }, pendingChanges: false, revision: "preview_1", documentVersion: VERSION, availableCommands: ["prepare_document_mail"], ...options.screen };
  const tools = load<typeof UiRuntime>("inrAssistantUiTools").createInrAssistantUiTools({ accountId: "account-A", edition: "founder", supabase: db,
    currentUserMessage: options.message ?? message, clientContext: parseInrAssistantClientContext({ screen }),
    canStartWork: () => !options.expired && !(options.expireAfterRead && reads > 0),
  });
  return { run: async (input: Row = {}) => await tools.runScreenCommand.execute!({ command: "prepare_document_mail", instructionQuote: options.message ?? message, recipient, ...input }, { toolCallId: "mail", messages: [] }) as Row, reads: () => reads };
}

test("the actual runScreenCommand verifies a saved finalized version and requests compose only, never send/save/finalize", async () => {
  const h = harness(), result = await h.run();
  assert.equal(result.ok, true); assert.equal(result.status, "ui_action_requested"); assert.equal(h.reads(), 1);
  assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command: "prepare_document_mail", selection: { kind: "invoice", id: ID }, revision: "preview_1", expectedUpdatedAt: VERSION, recipient });
  assert.equal(result.navigation, undefined); assert.match(String(result.message), /ni sauvegardé ni finalisé/);
});
for (const [name, options] of Object.entries({
  unauthenticated: { auth: false }, otherAccount: { account: "account-B" }, edition: { edition: "pro" }, subscription: { subscription: false },
  expired: { expired: true }, expiredAfterRead: { expireAfterRead: true }, readError: { readError: true },
  foreignOwner: { row: { user_id: "account-B" } }, foreignId: { row: { id: OTHER } }, wrongType: { row: { type: "devis" } },
  outdated: { row: { updated_at: "2026-11-02T13:00:00Z" } }, draft: { payload: { isFinalized: false } }, template: { payload: { isTemplate: true } }, noNumber: { payload: { number: "" } },
  dirty: { screen: { pendingChanges: true } }, unknownDirty: { screen: { pendingChanges: undefined } }, missingVersion: { screen: { documentVersion: undefined } },
  notMounted: { screen: { availableCommands: [] } }, wrongPath: { screen: { pathname: "/dashboard/ads" } }, preview: { screen: { selection: { kind: "invoice", id: "preview_1" } } },
})) test(`document mail refuses ${name} without requesting a browser action`, async () => {
  const result = await harness(options).run(); assert.equal(result.ok, false); assert.equal(result.uiCommand, undefined);
});

for (const denied of [
  `Comment préparer un mail à ${recipient} avec le PDF de cette facture ?`,
  `Ne prépare pas un mail à ${recipient} avec le PDF de cette facture.`,
  `Sans préparer de mail à ${recipient} avec le PDF de cette facture.`,
  `Si je confirme, prépare un mail à ${recipient} avec le PDF de cette facture.`,
  `Prépare un mail à ${recipient} avec le PDF de cette facture seulement après ma confirmation.`,
  `Prépare un mail à ${recipient} avec le PDF de cette facture demain.`,
  `Le texte dit « Prépare un mail à ${recipient} avec le PDF de cette facture ».`,
  `Le texte dit 'Prépare un mail à ${recipient} avec le PDF de cette facture'.`,
  "```\nexemple\n" + `Prépare un mail à ${recipient} avec le PDF de cette facture.\n` + "```",
  `Prépare un mail à autre@example.test avec le PDF de cette facture.`,
  `Prépare un mail à ${recipient} avec le PDF de la facture FAC-2026-0010.`,
  `Prépare un mail à ${recipient} avec le PDF de ce devis.`,
]) test(`document mail keeps non-instructions, other recipients and other document references inert: ${denied.slice(0, 65)}`, async () => {
  assert.equal((await harness({ message: denied }).run()).ok, false);
});

test("an exact named document is accepted, but a substituted target or attachment patch is refused", async () => {
  assert.equal((await harness({ message: `Prépare le mail à ${recipient} avec le PDF de la facture FAC-2026-001.` }).run()).ok, true);
  const exact = await harness().run({ documentId: ID, documentKind: "invoice" });
  assert.equal(exact.ok, true);
  assert.equal((exact.uiCommand as { selection: { id: string; kind: string } }).selection.id, ID);
  assert.equal((exact.uiCommand as { selection: { id: string; kind: string } }).selection.kind, "invoice");
  assert.equal((await harness().run({ documentId: OTHER })).ok, false);
  assert.equal((await harness().run({ documentKind: "quote" })).ok, false);
  assert.equal((await harness().run({ patch: { name: "tamper" } })).ok, false);
  assert.equal((await harness().run({ instructionQuote: "prépare un mail" })).ok, false);
});

test("document mail parsing requires a real ID, one explicit recipient, a revision and a timestamp", () => {
  const valid = { command: "prepare_document_mail", selection: { kind: "invoice", id: ID }, revision: "r1", expectedUpdatedAt: VERSION, recipient };
  for (const patch of [{ recipient: "alice@example.test,bob@example.test" }, { recipient: "alice@example.test\r\nBcc:other@example.test" }, { recipient: "" }, { expectedUpdatedAt: "" }, { revision: "" }, { selection: { kind: "invoice", id: "preview_local" } }]) assert.equal(documentCommands.parseInrAssistantDocumentMailCommand({ ...valid, ...patch }), null);
  assert.deepEqual(documentCommands.parseInrAssistantDocumentMailCommand({ ...valid, send: true, finalize: true }), valid, "unknown side-effect flags are never propagated");
});
