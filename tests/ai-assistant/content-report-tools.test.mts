import assert from "node:assert/strict";
import test from "node:test";
import { isInrAssistantContentReportSubmitRequest, parseInrAssistantContentReportCommand, parseInrAssistantContentReportHint, registerInrAssistantContentReport, runInrAssistantContentReportCommand } from "../../lib/inrAssistantContentReport.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
const revision = "10000000-0000-4000-8000-000000000001";
const scope = { actorUserId: "actor", accountId: "account", pathname: "/dashboard" };
const command = { command: "submit_content_report" as const, selection: { kind: "account_document" as const, id: "content_report" as const }, revision };
type Row = Record<string, unknown>;
const row = (value: unknown): Row => { assert.ok(value && typeof value === "object" && !Array.isArray(value)); return value as Row; };

test("Content report submission requires an explicit current unquoted unconditional sending instruction", () => {
  for (const message of ["Envoie ce signalement.", "Envoyez le signalement affiché.", "Peux-tu envoyer ce signalement ?", "Send this content report."]) assert.equal(isInrAssistantContentReportSubmitRequest(message), true, message);
  for (const message of ["Prépare ce signalement.", "Ouvre le signalement.", "Comment envoyer ce signalement ?", "Peux-tu me dire comment envoyer ce signalement ?", "Ne transmets pas ce signalement.", "Le client dit « Envoie ce signalement ».", "Envoie ce signalement demain.", "Envoie ce signalement plus tard.", "Envoie ce signalement après validation.", "Envoie ce signalement, si le commentaire convient.", "Send this report tomorrow.", "Envoie ce signalement dans 15 minutes."]) assert.equal(isInrAssistantContentReportSubmitRequest(message), false, message);
});

test("Content report schemas accept only a native draft revision and never carry private report fields or authority", () => {
  assert.deepEqual(parseInrAssistantContentReportHint({ revision }), { revision });
  assert.equal(parseInrAssistantContentReportHint({ revision, content: "private" }), undefined);
  assert.equal(parseInrAssistantContentReportHint({ revision: "content_report" }), undefined);
  assert.deepEqual(parseInrAssistantContentReportCommand(command), command);
  for (const change of [{ content: "private" }, { url: "https://external.invalid" }, { revision: "other" }, { selection: { ...command.selection, scope: "other" } }]) assert.equal(parseInrAssistantContentReportCommand({ ...command, ...change }), null);
});

test("Dedicated report tool validates both current instruction and quote and authenticates the exact actor", async () => {
  let actor = "actor", reads = 0;
  const load = runtimeModules({ "./requireUser": { requireUser: async () => { reads++; return { activeUserId: "account", authUserId: actor }; } } });
  const runtime = load<typeof import("../../lib/inrAssistantContentReportTools.ts")>("lib/inrAssistantContentReportTools.ts");
  const make = (message: string, canStartWork = () => true) => runtime.createInrAssistantContentReportTools({ ...scope, currentUserMessage: message, clientContext: { contentReport: { revision } }, canStartWork }).submitContentReport;
  const execute = async (message: string, quote = message, canStartWork?: () => boolean) => row(await make(message, canStartWork).execute!({ revision, instructionQuote: quote }, {} as never));
  const result = await execute("Envoie ce signalement.");
  assert.equal(result.status, "ui_action_requested"); assert.deepEqual(result.uiCommand, command); assert.equal(reads, 1);
  for (const message of ["Envoie ce signalement demain.", "Si le professionnel valide, envoie ce signalement.", "Explique comment envoyer ce signalement.", "Le client a dit « Envoie ce signalement. »."]) assert.equal((await execute(message, "Envoie ce signalement.")).code, "needs_instruction");
  assert.equal(reads, 1, "Invalid authority must not even authenticate a submission");
  assert.equal((await execute("Envoie ce signalement.", "Envoie ce signalement.", () => false)).code, "blocked");
  actor = "other"; assert.equal((await execute("Envoie ce signalement.")).code, "account_changed");
  const stale = row(await make("Envoie ce signalement.").execute!({ revision: crypto.randomUUID(), instructionQuote: "Envoie ce signalement." }, {} as never)); assert.equal(stale.code, "missing_or_stale_draft");
});

test("Dedicated report runner refuses duplicate open forms foreign scopes and a changed revision before native invocation", async t => {
  let sends = 0;
  const entry = { ...scope, revision, open: true, attempted: false, status: "idle" as const, submit: async () => { sends++; return false; } };
  registerInrAssistantContentReport("report-test", entry); t.after(() => { registerInrAssistantContentReport("report-test", null); registerInrAssistantContentReport("report-other", null); });
  assert.equal(await runInrAssistantContentReportCommand({ ...command, revision: crypto.randomUUID() }, scope, () => true), false);
  assert.equal(await runInrAssistantContentReportCommand(command, { ...scope, accountId: "foreign" }, () => true), false);
  registerInrAssistantContentReport("report-other", entry);
  assert.equal(await runInrAssistantContentReportCommand(command, scope, () => true), false); assert.equal(sends, 0);
  registerInrAssistantContentReport("report-other", null);
  assert.equal(await runInrAssistantContentReportCommand(command, scope, () => false), false); assert.equal(sends, 0);
  assert.equal(await runInrAssistantContentReportCommand(command, scope, () => true), false); assert.equal(sends, 1);
  assert.equal(await runInrAssistantContentReportCommand(command, scope, () => true), false); assert.equal(sends, 1, "An uncertain first native attempt cannot be replayed");
});

test("Dedicated report runner bounds an unanswered native submission without unlocking an automatic second send", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let sends = 0;
  registerInrAssistantContentReport("report-timeout", { ...scope, revision, open: true, attempted: false, status: "idle", submit: async () => { sends++; return new Promise<boolean>(() => {}); } });
  t.after(() => registerInrAssistantContentReport("report-timeout", null));
  const result = runInrAssistantContentReportCommand(command, scope, () => true);
  t.mock.timers.tick(10001); assert.equal(await result, false); assert.equal(sends, 1);
  assert.equal(await runInrAssistantContentReportCommand(command, scope, () => true), false); assert.equal(sends, 1);
});

test("Dedicated report tool stops when the current request expires during native authentication", async () => {
  let current = true, release!: () => void;
  const load = runtimeModules({ "./requireUser": { requireUser: async () => { await new Promise<void>(resolve => { release = resolve; }); return { activeUserId: "account", authUserId: "actor" }; } } });
  const runtime = load<typeof import("../../lib/inrAssistantContentReportTools.ts")>("lib/inrAssistantContentReportTools.ts");
  const tool = runtime.createInrAssistantContentReportTools({ ...scope, currentUserMessage: "Envoie ce signalement.", clientContext: { contentReport: { revision } }, canStartWork: () => current }).submitContentReport;
  const pending = tool.execute!({ revision, instructionQuote: "Envoie ce signalement." }, {} as never);
  current = false; release(); assert.equal(row(await pending).code, "blocked");
});
