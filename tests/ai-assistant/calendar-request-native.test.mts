import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", EVENT = "20000000-0000-4000-8000-000000000002";
const copy = (value: Row) => JSON.parse(JSON.stringify(value)) as Row;
const object = (value: unknown) => value && typeof value === "object" ? value as Row : {};
const fingerprint = (value: Row) => JSON.stringify(value);
// Execute the real route handler and its SQL predicates. Only authentication,
// storage and the native mail delivery boundary are synthetic.
function harness(mode = "normal") {
  let record: Row = { id: EVENT, user_id: ACCOUNT, title: "Demande Alice", description: null, location: "Atelier", start_at: "2026-12-01T09:00:00Z", end_at: "2026-12-01T10:00:00Z", all_day: false, meta: { source: "inrbadge", status: "pending", contact: { email: "alice@example.test" }, guests: [{ email: "invite@example.test" }] } };
  if (mode === "confirmed") object(record.meta).status = "confirmed";
  if (mode === "foreign") record.user_id = "other";
  const before = copy(record); let mails = 0, writes = 0;
  const from = (table: string) => {
    assert.equal(table, "agenda_events"); let patch: Row | undefined; const filters: Array<[string, unknown]> = [];
    const execute = () => {
      assert.ok(filters.some(([field, value]) => field === "user_id" && value === ACCOUNT));
      const matches = () => filters.every(([field, value]) => field === "meta" ? JSON.stringify(record.meta) === value : record[field] === value);
      if (!patch) { const data = matches() ? copy(record) : null; if (mode === "race") record.title = "Changé en parallèle"; return { data, error: null }; }
      writes++;
      if (mode === "db-error") return { data: null, error: { private: "secret" } };
      if (!matches()) return { data: null, error: null };
      record = { ...record, ...patch }; return { data: { id: EVENT }, error: null };
    };
    const query = { select: () => query, eq: (field: string, value: unknown) => { filters.push([field, value]); return query; }, is: (field: string, value: unknown) => { filters.push([field, value]); return query; }, update: (value: Row) => { patch = value; return query; }, maybeSingle: async () => execute(), then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject) };
    return query;
  };
  const full = readFileSync(new URL("../../app/api/calendar/appointment-requests/route.ts", import.meta.url), "utf8");
  const source = ts.createSourceFile("route.ts", full, ts.ScriptTarget.Latest, true);
  const handler = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "PATCH");
  assert.ok(handler);
  const loadedModule = { exports: {} as { PATCH: (request: Request) => Promise<Response> } };
  const output = ts.transpileModule(handler.getFullText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(module,exports){${output}\n})`, {
    Request, URL, Date, console: { error() {}, warn() {} },
    requireUser: async () => ({ supabase: { from }, activeUserId: ACCOUNT, errorResponse: mode === "unauthenticated" ? Response.json({}, { status: 401 }) : null }),
    safeObj: object, calendarEventFingerprint: fingerprint,
    isPendingInrBadgeRequest: (meta: Row) => String(meta.source).toLowerCase() === "inrbadge" && String(meta.status).toLowerCase() === "pending",
    bad: (error: string, status = 400) => Response.json({ ok: false, error }, { status }),
    jsonUserFacingError: () => Response.json({ ok: false, error: "Indisponible" }, { status: 500 }),
    NextResponse: { json: Response.json },
    sendAppointmentRejectionEmail: async () => { mails++; if (mode === "mail-uncertain") throw new Error("Transport interrupted"); if (mode === "edit-during-mail") record.meta = { ...object(record.meta), userNote: "Conserver cette saisie" }; return true; },
  })(loadedModule, loadedModule.exports);
  const request = (body: Row = {}) => new Request(`https://fixture.invalid/api/calendar/appointment-requests?id=${EVENT}`, { method: "PATCH", body: JSON.stringify({ action: "reject", ...body }) });
  return { patch: (body?: Row) => loadedModule.exports.PATCH(request(body)), before, record: () => record, mails: () => mails, writes: () => writes };
}

test("native client request rejection is claimed once before email and preserves the event", async () => {
  const h = harness(); const body = { expectedState: fingerprint(h.before), approvalReference: "IA-012345ABCDEF" };
  assert.equal((await h.patch(body)).status, 200); assert.equal(h.mails(), 1);
  assert.equal(h.record().id, EVENT); assert.equal(object(h.record().meta).status, "rejected");
  assert.equal(object(h.record().meta).assistantConfirmedAction, body.approvalReference);
  assert.deepEqual(object(h.record().meta).guests, object(h.before.meta).guests);
  assert.equal((await h.patch(body)).status, 409); assert.equal(h.mails(), 1);
});

test("native rejection handles stale preview, racing tabs, foreign scope and write failure without mail", async () => {
  for (const [mode, status] of [["stale", 409], ["race", 409], ["confirmed", 409], ["foreign", 404], ["db-error", 500], ["unauthenticated", 401]] as const) {
    const h = harness(mode), response = await h.patch(mode === "stale" ? { expectedState: "stale" } : undefined);
    assert.equal(response.status, status, mode); assert.equal(h.mails(), 0, mode);
    assert.notEqual(object(h.record().meta).status, "rejected", mode);
  }
});

test("mail completion cannot overwrite newer metadata and uncertain mail is never repeated", async () => {
  const h = harness("edit-during-mail"); assert.equal((await h.patch()).status, 200);
  assert.equal(object(h.record().meta).userNote, "Conserver cette saisie"); assert.equal(h.mails(), 1);
  const uncertain = harness("mail-uncertain"), response = await uncertain.patch();
  assert.equal(response.status, 200); assert.equal((await response.json()).rejectionMailSent, false);
  assert.equal(object(uncertain.record().meta).status, "rejected");
  assert.equal((await uncertain.patch()).status, 409); assert.equal(uncertain.mails(), 1);
});
