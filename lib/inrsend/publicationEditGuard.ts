import "server-only";
import { assistantActionFingerprint } from "../inrAssistantActionPreview.ts";
import { parsePublicationEditPrecondition } from "./publicationEditVersion.ts";

type Row = Record<string, unknown>;
type LockResult = { state: string; lock: { id: string; result?: Row | null; metadata?: Row | null } | null };
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const UNKNOWN = { ok: false, code: "publication_edit_result_unknown", error: "Une modification de cette version a déjà été engagée. Vérifiez son résultat dans iNr’Send et sur le canal ; aucune relance automatique n’est autorisée." };
export class PublicationEditSourceChangedError extends Error { constructor() { super("La publication ou la session a changé. Rouvrez son détail avant de modifier ce canal."); } }

/** Seal a durable no-retry receipt BEFORE provider work. A lost response,
 * process crash or expired lease can never authorize that source version again. */
export async function guardPublishedPublicationEdit(options: {
  body: Row; currentScope: () => Promise<boolean>; readVersion: () => Promise<string>;
  acquire: (key: string, fingerprint: string) => Promise<LockResult>;
  /** Read-only validation must finish before a source version is consumed. */
  validate?: () => Promise<Response | null>;
  seal: (lockId: string, result: Row) => Promise<void>; mutate: () => Promise<Response>;
}): Promise<Response> {
  const condition = parsePublicationEditPrecondition(options.body);
  if (!condition) return Response.json({ ok: false, code: "publication_edit_precondition_required", error: "Rouvrez le détail de la publication avant de l’enregistrer : sa version doit être vérifiée." }, { status: 428 });
  if (!await options.currentScope()) return Response.json({ ok: false, code: "publication_edit_scope_changed", error: "La session ou l’établissement actif a changé." }, { status: 409 });
  const { expectedState } = condition;
  const patch = { ...options.body }; delete patch.expectedState; delete patch.operationKey;
  const fingerprint = assistantActionFingerprint(patch), versionBeforeLock = await options.readVersion();
  if (options.validate) {
    if (versionBeforeLock !== expectedState) return Response.json({ ok: false, code: "publication_edit_source_changed", error: "La publication ou la session a changé. Rouvrez son détail avant de modifier ce canal." }, { status: 409 });
    if (!await options.currentScope()) return Response.json({ ok: false, code: "publication_edit_scope_changed", error: "La session ou l’établissement actif a changé." }, { status: 409 });
    const invalid = await options.validate();
    if (!await options.currentScope()) return Response.json({ ok: false, code: "publication_edit_scope_changed", error: "La session ou l’établissement actif a changé." }, { status: 409 });
    if (invalid) return invalid;
  }
  const lock = await options.acquire(expectedState, fingerprint);
  if (!await options.currentScope()) return Response.json({ ok: false, code: "publication_edit_scope_changed", error: "La session ou l’établissement actif a changé." }, { status: 409 });
  if (lock.state === "completed") {
    const saved = row(lock.lock?.result);
    if (saved.requestFingerprint !== fingerprint) return Response.json({ ...UNKNOWN, code: "publication_edit_version_already_attempted" }, { status: 409 });
    const status = Number(saved.httpStatus);
    return Response.json(Object.keys(row(saved.body)).length ? row(saved.body) : UNKNOWN, { status: Number.isInteger(status) && status >= 200 && status <= 599 ? status : 409 });
  }
  if (lock.state !== "acquired" || !lock.lock?.id) return Response.json(UNKNOWN, { status: lock.state === "running" ? 409 : 503 });
  const unknownReceipt = { requestFingerprint: fingerprint, httpStatus: 409, body: UNKNOWN };
  try { await options.seal(lock.lock.id, unknownReceipt); }
  catch { return Response.json({ ok: false, code: "publication_edit_lock_unconfirmed", error: "La protection contre les doublons n’a pas pu être confirmée. Aucune modification du canal n’a été lancée." }, { status: 503 }); }
  if (!await options.currentScope() || versionBeforeLock !== expectedState || await options.readVersion() !== expectedState) return Response.json({ ok: false, code: "publication_edit_source_changed", error: "La publication ou la session a changé. Rouvrez son détail avant de modifier ce canal." }, { status: 409 });
  try {
    const response = await options.mutate(), body = row(await response.clone().json().catch(() => null));
    // Keep the durable receipt small. Native consumers re-read their actual
    // saved event; they never treat cached payload URLs as a new provider check.
    const receiptBody: Row = response.ok && body.ok === true
      ? { ok: true, publication_id: body.publication_id, channel: body.channel, cachedReceipt: true, ...(body.pending === true ? { pending: true, queued: true } : {}) }
      : { ...UNKNOWN, code: typeof body.code === "string" ? body.code : UNKNOWN.code };
    try { await options.seal(lock.lock.id, { requestFingerprint: fingerprint, httpStatus: response.status, body: receiptBody }); }
    catch { return Response.json(UNKNOWN, { status: 409 }); }
    return response;
  } catch { return Response.json(UNKNOWN, { status: 409 }); }
}
