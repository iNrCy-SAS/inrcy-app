import "server-only";
import { supabaseAdmin } from "./supabaseAdmin";
import { assistantActionFingerprint, createAssistantActionPreview, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { ASSISTANT_ATTACHMENT_BUCKET, ASSISTANT_ATTACHMENT_UUID } from "./inrAssistantAttachments.ts";
import { inrAssistantUiSuccessStatus, parseInrAssistantUiActions, parseInrAssistantUiResult, type InrAssistantUiAction, type InrAssistantUiResult } from "./inrAssistantUiActions.ts";
import { inrAssistantUiPostScreenMatchesAction } from "./inrAssistantUiPostScreen.ts";

type Scope = { accountId: string; actorUserId: string; conversationId: string };
type Turn = { turnId: string; createdAt: string };
type UiPlan = Scope & Turn & { actions: InrAssistantUiAction[]; fingerprint: string };
const KIND = "assistant_browser_actions";
const store = () => supabaseAdmin.storage.from(ASSISTANT_ATTACHMENT_BUCKET);
const validScope = (scope: Scope, turn: Turn) => [scope.accountId, scope.actorUserId, scope.conversationId, turn.turnId].every(value => ASSISTANT_ATTACHMENT_UUID.test(value))
  && /^\d{4}-\d{2}-\d{2}T/.test(turn.createdAt) && Number.isFinite(Date.parse(turn.createdAt));

/** The token is added after model execution. It binds an exact plan, not a business permission. */
export function createInrAssistantUiReceiptToken(scope: Scope, turn: Turn, actions: InrAssistantUiAction[]): string {
  const parsed = parseInrAssistantUiActions(actions);
  if (!validScope(scope, turn) || !parsed?.length) throw new Error("Invalid browser action plan");
  return createAssistantActionPreview({ accountId: scope.accountId, actorUserId: scope.actorUserId, kind: KIND, targetId: turn.turnId,
    fingerprint: assistantActionFingerprint(parsed), patch: { conversationId: scope.conversationId, createdAt: turn.createdAt, actions: parsed } }).token;
}

export function verifyInrAssistantUiReceiptToken(token: string, scope: Pick<Scope, "accountId" | "actorUserId">): UiPlan | null {
  const claims = verifyAssistantActionPreview(token, { ...scope, kind: KIND });
  if (!claims) return null;
  const actions = parseInrAssistantUiActions(claims.patch.actions);
  const plan = { ...scope, conversationId: String(claims.patch.conversationId ?? ""), turnId: claims.targetId, createdAt: String(claims.patch.createdAt ?? "") };
  return actions?.length && validScope(plan, plan) && assistantActionFingerprint(actions) === claims.fingerprint ? { ...plan, actions, fingerprint: claims.fingerprint } : null;
}

async function bounded<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Browser receipt unavailable")), 5_000); timer.unref?.(); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function receiptPath(plan: UiPlan, actionId: string, kind: "claim" | "result") {
  if (!plan.actions.some(action => action.id === actionId)) throw new Error("Unknown browser action");
  return `${plan.createdAt.slice(0, 10)}/${plan.accountId}_${plan.actorUserId}_${plan.conversationId}_${plan.turnId}.ui-${assistantActionFingerprint(actionId).slice(0, 24)}.${kind}.json`;
}
async function readRecord(plan: UiPlan, actionId: string, kind: "claim" | "result"): Promise<Record<string, unknown> | null> {
  const response = await bounded(store().download(receiptPath(plan, actionId, kind)));
  if (response.error) {
    const error = response.error as { statusCode?: string | number; message?: string; error?: string };
    if (["404", "400"].includes(String(error.statusCode)) && /not.?found|not.?exist|NoSuchKey/i.test(`${error.message ?? ""} ${error.error ?? ""}`)) return null;
    throw new Error("Browser receipt unavailable");
  }
  if (!response.data || response.data.size > 5_000) throw new Error("Invalid browser receipt");
  const row = JSON.parse(await response.data.text());
  if (row?.version !== 1 || row.accountId !== plan.accountId || row.actorUserId !== plan.actorUserId || row.conversationId !== plan.conversationId || row.turnId !== plan.turnId || row.fingerprint !== plan.fingerprint || row.actionId !== actionId) throw new Error("Invalid browser receipt");
  return row;
}
async function writeRecord(plan: UiPlan, actionId: string, kind: "claim" | "result", value: Record<string, unknown>) {
  return bounded(store().upload(receiptPath(plan, actionId, kind), Buffer.from(JSON.stringify({ version: 1, accountId: plan.accountId, actorUserId: plan.actorUserId, conversationId: plan.conversationId, turnId: plan.turnId, fingerprint: plan.fingerprint, actionId, recordedAt: new Date().toISOString(), ...value })), { contentType: "application/json", upsert: false }));
}

/** First claimant wins across tabs/retries. An uncertain claim is never automatically replayed. */
export async function claimInrAssistantUiAction(plan: UiPlan, actionId: string): Promise<boolean> {
  const actionIndex = plan.actions.findIndex(action => action.id === actionId);
  if (actionIndex < 0) return false;
  for (const predecessor of plan.actions.slice(Math.max(0, actionIndex - 1), actionIndex)) {
    const row = await readRecord(plan, predecessor.id, "result");
    const result = parseInrAssistantUiResult(row?.result);
    if (!result || !["applied", "handed_to_browser"].includes(result.status)) return false;
  }
  const response = await writeRecord(plan, actionId, "claim", { source: "browser_reported", status: "claimed" });
  if (!response.error) return true;
  if (await readRecord(plan, actionId, "claim")) return false;
  throw new Error("Browser claim unavailable");
}

export async function saveInrAssistantUiResult(plan: UiPlan, raw: unknown): Promise<InrAssistantUiResult | null> {
  const result = parseInrAssistantUiResult(raw);
  const action = result && plan.actions.find(action => action.id === result.actionId);
  if (!result || !action || ["applied", "handed_to_browser"].includes(result.status) && result.status !== inrAssistantUiSuccessStatus(action)) return null;
  if (result.postScreen && !inrAssistantUiPostScreenMatchesAction(action, result.postScreen)) return null;
  if (!await readRecord(plan, result.actionId, "claim")) return null;
  const response = await writeRecord(plan, result.actionId, "result", { result });
  if (!response.error) return result;
  // Immutable first report wins; callers cannot rewrite a failed result as success.
  return parseInrAssistantUiResult((await readRecord(plan, result.actionId, "result"))?.result);
}

export async function loadInrAssistantUiResults(scope: Scope, turn: Turn, actions: InrAssistantUiAction[]): Promise<InrAssistantUiResult[]> {
  const parsed = parseInrAssistantUiActions(actions);
  if (!validScope(scope, turn) || !parsed?.length) return [];
  const plan = { ...scope, ...turn, actions: parsed, fingerprint: assistantActionFingerprint(parsed) };
  const rows = await Promise.all(parsed.map(async action => parseInrAssistantUiResult((await readRecord(plan, action.id, "result"))?.result)));
  return rows.filter((row): row is InrAssistantUiResult => Boolean(row));
}
