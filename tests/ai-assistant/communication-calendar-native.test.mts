import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Route from "../../app/api/calendar/events/route.ts";

const { NextResponse } = createRequire(import.meta.url)("next/server") as typeof import("next/server");
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", EVENT = "60000000-0000-4000-8000-000000000006";
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const previewModule = { exports: {} as { calendarEventFingerprint: (row: Row) => string } };
const previewSource = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantActionPreview.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(require,module,exports){${previewSource}\n})`, { Date, Buffer, process: { env: {} } })((name: string) => { assert.ok(["server-only", "node:crypto"].includes(name)); return name === "node:crypto" ? crypto : {}; }, previewModule, previewModule.exports);

/** Execute the actual calendar PATCH, including its draft CAS and mail branches. */
function harness(options: { initialStatus?: string; confirmedAfterRead?: boolean; changedAfterRead?: boolean; updateError?: boolean } = {}) {
  let record: Row = { id: EVENT, user_id: ACCOUNT, title: "Toiture", description: "Visite", location: "Atelier", start_at: "2026-12-01T09:00:00.000Z", end_at: "2026-12-01T10:00:00.000Z", all_day: false,
    meta: { status: options.initialStatus ?? "draft", source: "manual", guests: [], reminders: { enabled: false, inAppMinutesBefore: 120, emailMinutesBefore: 1440, mailAccountId: null, lastInAppReminderAt: null, lastEmailReminderAt: null } } };
  const writes: Array<{ fields: Row; filters: Array<[string, unknown]> }> = [];
  let notifications = 0, mails = 0;
  const supabase = { from(table: string) {
    if (table === "pro_tools_configs") return { select() { return this; }, eq(field: string, value: unknown) { assert.equal(field, "user_id"); assert.equal(value, ACCOUNT); return this; }, maybeSingle: async () => ({ data: { settings: { inrcalendar: { send_confirmation_on_save: false } } }, error: null }) };
    assert.equal(table, "agenda_events");
    const filters: Array<[string, unknown]> = [];
    let patch: Row | undefined;let deleting=false;
    const matches = () => filters.every(([field, value]) => field === "meta->>status" ? object(record.meta).status === value : field === "meta" ? JSON.stringify(record.meta) === value : record[field] === value);
    const execute = () => {
      assert.ok(filters.some(([field, value]) => field === "id" && value === EVENT));
      assert.ok(filters.some(([field, value]) => field === "user_id" && value === ACCOUNT));
      if (!patch && !deleting) {
        const snapshot = JSON.parse(JSON.stringify(record)) as Row;
        if (options.confirmedAfterRead) record.meta = { ...object(record.meta), status: "confirmed" };
        if (options.changedAfterRead) record.title = "Concurrent title";
        return { data: snapshot, error: null };
      }
      writes.push({ fields: patch??{delete:true}, filters });
      if (options.updateError) return { data: null, error: { code: "PRIVATE WRITE ERROR" } };
      if (!matches()) return { data: null, error: null };
      record = deleting?{}:{ ...record, ...patch };
      return { data: { id: EVENT }, error: null };
    };
    const builder = {
      select() { return builder; }, eq(field: string, value: unknown) { filters.push([field, value]); return builder; },
      is(field: string, value: unknown) { filters.push([field, value]); return builder; },
      update(fields: Row) { patch = fields; return builder; },
      delete(){deleting=true;return builder;},
      maybeSingle: async () => execute(),
      then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return builder;
  } };
  const unexpected = () => assert.fail("No Google sync, real email, auth admin or external provider may run");
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse }, "@/lib/requireUser": { requireUser: async () => ({ supabase, user: { id: ACCOUNT }, errorResponse: null, activeUserId: ACCOUNT }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: supabase.from, auth: { admin: { getUserById: unexpected } } } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: (_error: unknown, input: { status: number; extra: Row }) => NextResponse.json({ error: "Modification indisponible", ...input.extra }, { status: input.status }) },
    "@/lib/env": { optionalEnv: () => undefined },
    "@/lib/txMailer": { sendTxMail: async () => { mails++; unexpected(); } },
    "@/lib/inrsend/sendMailFromIntegration": { sendMailFromIntegration: async () => { mails++; unexpected(); } },
    "@/lib/observability/withApi": { withApi: (handler: unknown) => handler },
    "@/lib/observability/logger": { log: { info() {}, warn() {}, error() {} } },
    "@/lib/notificationWriter": { insertNotificationOnce: async () => { notifications++; } },
    "@/lib/inrCalendarGoogleSyncConstants": { INR_CALENDAR_GOOGLE_SOURCE: "google_calendar" },
    "@/lib/inrCalendarGoogleSync": { syncVisioSharedCalendarToInrCalendar: unexpected },
    "@/lib/visioTeamAccess": { getVisioTeamActor: unexpected },
    "@/lib/inrAssistantActionPreview": previewModule.exports,
    "@/lib/clientCommunication": { buildClientExchangePreferences: unexpected, DEFAULT_CLIENT_EXCHANGE_PREFERENCES: {}, formatClientDateOnly: unexpected, formatClientTimeOnly: unexpected, getCalendarClientTexts: unexpected },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../app/api/calendar/events/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Date, Intl, URL, console, fetch: unexpected })((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected native calendar dependency: ${name}`); return dependencies[name];
  }, moduleRecord, moduleRecord.exports);
  const api = moduleRecord.exports as typeof Route;
  return { patch: api.PATCH,delete:api.DELETE, writes, get record() { return record; }, get notifications() { return notifications; }, get mails() { return mails; } };
}

function request(requireDraft: boolean | "omit" = true) {
  return new Request(`https://app.inrcy.com/api/calendar/events?id=${EVENT}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
    ...(requireDraft === "omit" ? {} : { requireDraft }), summary: "Visite toiture modifiée", start: "2026-12-01T09:00:00.000Z", end: "2026-12-01T10:00:00.000Z", allDay: false,
    inrcy: { assistantCommunicationActionKey: "trusted-communication-marker" },
  }) });
}

test("assistant cancellation compares the draft status and metadata in the SQL DELETE",async()=>{
 for(const [options,expected] of [[{},200],[{initialStatus:"confirmed"},409],[{confirmedAfterRead:true},409]] as const){
  const h=harness(options),response=await h.delete(new Request(`https://app.inrcy.com/api/calendar/events?id=${EVENT}&requireDraft=true`,{method:"DELETE"}));
  assert.equal(response.status,expected);assert.equal(h.mails,0);assert.equal(h.notifications,0);
  if(expected === 200){assert.equal(h.record.id,undefined);assert.ok(h.writes[0].filters.some(([key,value])=>key === "meta->>status" && value === "draft"));assert.ok(h.writes[0].filters.some(([key])=>key === "meta"));}
 }
});

test("native assistant calendar edit conditions the actual SQL UPDATE on draft status and sends nothing", async () => {
  const h = harness(), response = await h.patch(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  assert.equal(h.writes.length, 1); assert.ok(h.writes[0].filters.some(([field, value]) => field === "meta->>status" && value === "draft"));
  assert.equal(h.record.title, "Visite toiture modifiée"); assert.equal(object(h.record.meta).status, "draft");
  assert.equal(object(h.record.meta).assistantCommunicationActionKey, "trusted-communication-marker");
  assert.equal(h.mails, 0); assert.equal(h.notifications, 0);
});

test("a concurrent UI confirmation wins the SQL comparison and cannot be overwritten, mailed or announced as edited", async () => {
  const h = harness({ confirmedAfterRead: true }), response = await h.patch(request());
  assert.equal(response.status, 409); assert.equal((await response.json()).ok, false);
  assert.equal(h.writes.length, 1); assert.equal(h.record.title, "Toiture"); assert.equal(object(h.record.meta).status, "confirmed");
  assert.equal(h.mails, 0); assert.equal(h.notifications, 0);
});

test("an already confirmed appointment is refused before any assistant write", async () => {
  const h = harness({ initialStatus: "confirmed" }), response = await h.patch(request());
  assert.equal(response.status, 409); assert.equal(h.writes.length, 0); assert.equal(h.mails, 0); assert.equal(h.notifications, 0);
});

test("a failed native calendar write keeps its public error and never emits notifications", async () => {
  const h = harness({ updateError: true }), response = await h.patch(request());
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /PRIVATE/);
  assert.equal(h.record.title, "Toiture"); assert.equal(h.mails, 0); assert.equal(h.notifications, 0);
});

test("ordinary agenda PATCH callers retain their prior confirmed-event behavior without the opt-in guard", async () => {
  const h = harness({ initialStatus: "confirmed" }), response = await h.patch(request("omit"));
  assert.equal(response.status, 200); assert.equal(h.record.title, "Visite toiture modifiée");
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].filters.some(([field]) => field === "meta->>status"), false);
  assert.equal(h.notifications, 1, "The existing native confirmation path is preserved for normal UI callers"); assert.equal(h.mails, 0);
});

test("approved confirmed-event changes compare the complete preview snapshot atomically and keep the native confirmation path", async () => {
  for (const changedAfterRead of [false, true]) {
    const h = harness({ initialStatus: "confirmed", changedAfterRead }), expectedState = previewModule.exports.calendarEventFingerprint(h.record);
    const body = await request("omit").json(); body.expectedState = expectedState;
    const response = await h.patch(new Request(`https://app.inrcy.com/api/calendar/events?id=${EVENT}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, changedAfterRead ? 409 : 200);
    assert.equal(h.notifications, changedAfterRead ? 0 : 1); assert.equal(h.mails, 0);
    for (const field of ["meta", "title", "description", "location", "start_at", "end_at", "all_day"]) assert.ok(h.writes[0].filters.some(([key]) => key === field), field);
    assert.equal(h.record.title, changedAfterRead ? "Concurrent title" : "Visite toiture modifiée");
  }
});

test("approved confirmed-event deletion refuses a changed snapshot both before and during the native delete", async () => {
  for (const mode of ["unchanged", "stale", "race"]) {
    const h = harness({ initialStatus: "confirmed", changedAfterRead: mode === "race" });
    const expectedState = mode === "stale" ? "0".repeat(64) : previewModule.exports.calendarEventFingerprint(h.record);
    const response = await h.delete(new Request(`https://app.inrcy.com/api/calendar/events?id=${EVENT}&expectedState=${expectedState}`, { method: "DELETE" }));
    assert.equal(response.status, mode === "unchanged" ? 200 : 409); assert.equal(h.notifications, 0); assert.equal(h.mails, 0);
    assert.equal(h.writes.length, mode === "stale" ? 0 : 1);
  }
});
