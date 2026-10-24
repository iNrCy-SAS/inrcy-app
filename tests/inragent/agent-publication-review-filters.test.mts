import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentType } from "react";
import type { InrAgentAction } from "../../lib/inrAgentActions.ts";
import { countPublicationValidationStates, filterPublicationsByValidation } from "../../app/dashboard/agent/_lib/agent.publication-validation.ts";
import { canRestoreRefusedPublication, isHiddenRefusedPublication } from "../../app/dashboard/agent/_lib/agent.publication-visibility.ts";
import { buildPublicationViewerItems, nextPublicationViewerId } from "../../app/dashboard/agent/_lib/agent.publication-carousel.ts";
import { runtimeModules } from "./runtime-module-loader.mts";

const all = { validated: true, pending: true, refused: true };
const actions = [
  { id: "approved", status: "scheduled" as const, validatedAt: null },
  { id: "waiting", status: "pending_validation" as const, validatedAt: null },
  { id: "refused", status: "refused" as const, validatedAt: "2026-10-01T10:00:00Z" },
  { id: "executed", status: "completed" as const, validatedAt: null },
];

test("les compteurs restent globaux et tous les statuts cochés conservent l'ordre", () => {
  assert.deepEqual(countPublicationValidationStates(actions), { validated: 2, pending: 1, refused: 1 });
  assert.deepEqual(filterPublicationsByValidation(actions, all), actions);
  assert.deepEqual(filterPublicationsByValidation(actions, { ...all, validated: false }).map(item => item.id), ["waiting", "refused"]);
  assert.deepEqual(countPublicationValidationStates(actions), { validated: 2, pending: 1, refused: 1 });
});

test("la navigation ne visite que les statuts cochés et une sélection exclue ne reste pas affichée", () => {
  const filtered = filterPublicationsByValidation(actions, { validated: false, pending: true, refused: true });
  const selected = filtered.find(item => item.id === "approved") ?? filtered[0];
  const items = buildPublicationViewerItems(filtered, selected, false);
  assert.deepEqual(items.map(item => item.id), ["waiting", "refused"]);
  assert.equal(nextPublicationViewerId(items, "waiting", 1), "refused");
  assert.equal(nextPublicationViewerId(items, "refused", 1), "waiting");
  assert.deepEqual(filterPublicationsByValidation(actions, { validated: false, pending: false, refused: false }), []);
});

const now = Date.now();
const future = new Date(now + 86_400_000).toISOString();
const planned = { automationKey: "publish", actionType: "publication", targetTool: "booster", status: "refused", scheduledFor: future, validationRequired: true, executionPolicy: "manual_validation", completedAt: null };

test("le refus sans date disparaît, un refus daté reste jusqu'à l'échéance existante", () => {
  for (const scheduledFor of [null, "", "invalide"]) assert.equal(isHiddenRefusedPublication({ ...planned, scheduledFor }, now), true);
  assert.equal(isHiddenRefusedPublication(planned, now), false);
  assert.equal(isHiddenRefusedPublication(planned, Date.parse(future)), true);
  assert.equal(canRestoreRefusedPublication(planned, now), true);
  assert.equal(canRestoreRefusedPublication(planned, Date.parse(future)), false);
  assert.equal(canRestoreRefusedPublication({ ...planned, scheduledFor: null }, now), false);
  assert.equal(canRestoreRefusedPublication({ ...planned, completedAt: future }, now), false);
  assert.equal(canRestoreRefusedPublication({ ...planned, executionPolicy: "automatic_after_settings" }, now), false);
});

function database({ owner = "account", status = "refused", scheduledFor = future, stale = false, race = false, fail = false } = {}) {
  const row: Record<string, unknown> = { id: "publication", user_id: owner, status, scheduled_for: scheduledFor,
    validated_at: "2026-10-01T10:00:00Z", refused_at: "2026-10-02T10:00:00Z", completed_at: null,
    updated_at: "2026-10-03T10:00:00Z", validation_required: true, execution_policy: "manual_validation", payload: { original: "unchanged" }, target_channels: ["facebook"] };
  const writes: Record<string, unknown>[] = [];
  const queries: { table: string; filters: [string, unknown][] }[] = [];
  const db = { from(table: string) {
    const filters: [string, unknown][] = [];
    const greater: [string, string][] = [];
    let patch: Record<string, unknown> | null = null;
    queries.push({ table, filters });
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      gt(key: string, value: string) { greater.push([key, value]); return query; },
      is(key: string, value: unknown) { filters.push([key, value]); return query; },
      update(value: Record<string, unknown>) { patch = value; return query; },
      async maybeSingle() {
        if (fail) return { data: null, error: { message: "unavailable" } };
        if (patch && race) row.updated_at = "2026-10-04T10:00:00Z";
        if (filters.some(([key, value]) => row[key] !== value) || greater.some(([key, value]) => Date.parse(String(row[key])) <= Date.parse(value))) return { data: null, error: null };
        if (patch) { writes.push(patch); Object.assign(row, patch); }
        return { data: structuredClone(stale ? { ...row, updated_at: "2026-10-04T10:00:00Z" } : row), error: null };
      },
    };
    return query;
  } };
  const load = runtimeModules({ "@/lib/supabaseAdmin": { supabaseAdmin: db }, "@/lib/inrAgentActions": {
    rowToInrAgentAction: (record: Record<string, unknown>) => ({ ...planned, id: record.id, status: record.status,
      scheduledFor: record.scheduled_for, validatedAt: record.validated_at, refusedAt: record.refused_at, completedAt: record.completed_at,
      validationRequired: record.validation_required, executionPolicy: record.execution_policy, updatedAt: record.updated_at, payload: record.payload }),
  } });
  const server = load<{ restoreRefusedInrAgentPublication: (args: Record<string, unknown>) => Promise<InrAgentAction> }>("lib/inrAgentPublicationRefusalServer.ts");
  return { ...server, row, queries, writes };
}
const restoreArgs = { accountId: "account", actionId: "publication", expectedUpdatedAt: "2026-10-03T10:00:00Z", select: "*" };

test("annuler le refus restaure seulement l'attente et conserve la date, le contenu et les canaux", async () => {
  const h = database();
  const result = await h.restoreRefusedInrAgentPublication(restoreArgs);
  assert.equal(result.status, "pending_validation");
  assert.equal(result.validatedAt, null);
  assert.equal(result.refusedAt, null);
  assert.equal(result.scheduledFor, future);
  assert.deepEqual(h.row.payload, { original: "unchanged" });
  assert.deepEqual(h.row.target_channels, ["facebook"]);
  assert.equal(h.writes.length, 1);
  assert.ok(h.queries.every(query => query.table === "inr_agent_actions" && query.filters.some(([key, value]) => key === "user_id" && value === "account")));
  await assert.rejects(h.restoreRefusedInrAgentPublication(restoreArgs), error => (error as { status?: number }).status === 409);
});

test("le serveur refuse autre compte, date dépassée, absence de date, version périmée et course", async () => {
  for (const setup of [
    { owner: "other" }, { scheduledFor: new Date(now - 1000).toISOString() }, { scheduledFor: "" },
    { stale: true }, { race: true }, { status: "completed" }, { fail: true },
  ]) {
    const h = database(setup);
    await assert.rejects(h.restoreRefusedInrAgentPublication(restoreArgs));
    assert.equal(h.writes.length, 0, JSON.stringify(setup));
  }
  const h = database();
  await assert.rejects(h.restoreRefusedInrAgentPublication({ ...restoreArgs, expectedUpdatedAt: null }));
  assert.equal(h.writes.length, 0);
});

test("la case TikTok suit l'attente réelle, y compris l'exclusion automatique et programmée", () => {
  const text = readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("AgentClient.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  let gate: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isAgentActionAwaitingValidation") declaration = node;
    if (ts.isConditionalExpression(node) && node.whenTrue.getText(source).includes("<TiktokReviewCheckbox")) gate = node.condition;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(declaration); assert.ok(gate);
  const fn = new Function("asRecord", "pendingActionStatuses", ts.transpileModule(declaration.getText(source) + "; return isAgentActionAwaitingValidation;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(
    (value: unknown) => value && typeof value === "object" ? value : null, new Set(["prepared", "pending_validation", "pending"]));
  const check = new Function("isAgentActionAwaitingValidation", "selectedPreparedAction", "isPublishView", "selectedPublicationUsesTiktok", "scheduledEditSession", "return " + gate.getText(source));
  for (const status of ["prepared", "pending_validation", "pending"]) assert.equal(check(fn, { status, payload: {}, validationRequired: true }, true, true, null), true);
  for (const status of ["validated", "scheduled", "completed", "refused", "cancelled"]) assert.equal(check(fn, { status, payload: {}, validationRequired: true }, true, true, null), false);
  assert.equal(check(fn, { status: "pending_validation", validationRequired: false }, true, true, null), false);
  assert.equal(check(fn, { status: "pending_validation", validationRequired: true }, true, false, null), false);
  assert.equal(check(fn, { status: "pending_validation", validationRequired: true }, true, true, {}), false);
});

test("la fenêtre de régénération propose les deux périmètres et garde le nom du canal", () => {
  const require = createRequire(import.meta.url);
  const code = readFileSync(new URL("../../app/dashboard/agent/_components/AgentFeedbackModals.tsx", import.meta.url), "utf8");
  const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const messages = JSON.parse(readFileSync(new URL("../../messages/fr-FR/agent.json", import.meta.url), "utf8"));
  const compiledModule = { exports: {} as { default: ComponentType<Record<string, unknown>> } };
  new Function("require", "module", "exports", javascript)((id: string) => {
    if (id === "next-intl") return { useTranslations: () => (key: string) => messages[key] || key };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (id.includes("PublishExecution")) return { __esModule: true, default: () => null };
    return require(id);
  }, compiledModule, compiledModule.exports);
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(compiledModule.exports.default, {
    publishExecutionProgress: null, publishSuccessSummary: null, campaignLaunchNotice: null,
    confirmDialog: { title: "Régénérer le média", message: "Choisissez le périmètre", choiceLayout: "regeneration", channelIcon: "/facebook.png", alternateLabel: "Facebook uniquement", confirmLabel: "Tous les canaux" },
    onClosePublishSuccess: noop, onOpenPublishedInrSend: noop, onCloseCampaignLaunch: noop, onOpenCampaignFolder: noop,
    onCloseConfirm: noop, onConfirm: noop, onAlternateConfirm: noop,
  }));
  assert.match(html, /Facebook uniquement/);
  assert.match(html, /Tous les canaux/);
  assert.match(html, /aria-label="Fermer"/);
  assert.doesNotMatch(html, /Annuler/);
  assert.equal((html.match(/<button /g) || []).length, 3, "Croix + deux choix principaux seulement");
});
