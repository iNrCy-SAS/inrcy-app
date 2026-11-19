import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as mirror from "../../lib/visioCalendarMirrorPolicy.ts";
import * as lifecycle from "../../lib/visioAppointmentLifecycle.ts";
import * as pending from "../../lib/visioPendingSignupPolicy.ts";

type Event = mirror.TeamCalendarEvent & { etag?: string };
type Write = { calendar: string; id: string; method: string; body: Event; headers: Record<string, string> };
const shared = "shared@example.invalid", publicCalendar = "public@example.invalid";
const userId = "11111111-1111-4111-8111-111111111111", email = "synthetic@example.invalid";
const input = { userId, email, firstName: "Synthetic", lastName: "Test", company: "Test", phone: "0102030405", createdAt: new Date().toISOString() };
type TokenApi = {
  createVisioBookingToken(input: { userId: string; email: string }): string;
  verifyVisioBookingToken(raw: unknown): { sub: string; email: string; nonce: string; iat: number };
};
const tokenApi = {} as TokenApi;
const tokenSource = ts.transpileModule(readFileSync("lib/visioBookingToken.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "exports", tokenSource)((name: string) => {
  if (name === "server-only") return {};
  if (name === "node:crypto") return crypto;
  if (name === "@/lib/env") return { optionalEnv: (_key: string, fallback: string) => fallback, requireEnv: () => "synthetic-booking-secret" };
  assert.fail(`Unmocked token dependency ${name}`);
}, tokenApi);

// Execute the actual reminder and booking cleanup functions, with real policies
// and token verification. Only the Calendar boundary and configuration are fake.
const source = ts.createSourceFile("visioBookingGoogle.ts", readFileSync("lib/visioBookingGoogle.ts", "utf8"), ts.ScriptTarget.Latest, true);
const names = ["ensurePendingSignupCalendarReminder", "bookingEventId", "withTeamCalendarAutomationSnapshot", "lifecycleStatusForEvent", "cancelSharedCalendarEvent", "removePendingSignupRemindersForProspect", "finalizeBookedVisio"];
const functions = names.map(name => {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing actual function ${name}`); return declaration.getText(source);
}).join("\n");
const compiled = ts.transpileModule(functions + "\nexport const fixture = { ensurePendingSignupCalendarReminder, bookingEventId, finalizeBookedVisio };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Api = {
  ensurePendingSignupCalendarReminder(value: typeof input & { bookingToken?: string }): Promise<{ status: string; eventId: string }>;
  bookingEventId(nonce: string): string;
  finalizeBookedVisio(claims: ReturnType<TokenApi["verifyVisioBookingToken"]>, confirmation: object): Promise<object>;
};

function fixture() {
  const calendars = new Map<string, Map<string, Event>>(), writes: Write[] = [], reads: Array<{ calendar: string; id: string; fresh: boolean }> = [];
  let version = 0;
  let masterLookupError: number | undefined;
  let beforeWrite: ((request: Write) => void | Promise<void>) | undefined;
  const events = (calendar: string) => { if (!calendars.has(calendar)) calendars.set(calendar, new Map()); return calendars.get(calendar)!; };
  const seed = (calendar: string, event: Event) => {
    assert.ok(event.id); const value = { ...structuredClone(event), etag: `"version-${++version}"` }; events(calendar).set(event.id, value); return structuredClone(value);
  };
  const boundaries = {
    ...mirror, ...lifecycle, ...pending, createHash: crypto.createHash, ...tokenApi,
    PRIVATE_BOOKING_KEY: "inrcyBooking", PRIVATE_BOOKING_VALUE: "signup-visio",
    getVisioSharedCalendarId: () => shared, getVisioPublicCalendarId: () => publicCalendar,
    encodeCalendarId: encodeURIComponent,
    getCalendarEvent: async (calendar: string, id: string, options?: { fresh: boolean }) => {
      reads.push({ calendar, id, fresh: Boolean(options?.fresh) }); return structuredClone(events(calendar).get(id) ?? null);
    },
    listVisioSharedCalendarEvents: async () => structuredClone([...events(shared).values()]),
    detachTeamCalendarAutomation: () => assert.fail("A concurrent signup cannot detach a human event"),
    googleCalendarRequest: async (path: string, init: RequestInit) => {
      const url = new URL(path, "https://calendar.example.invalid");
      const match = url.pathname.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/); assert.ok(match);
      if (init.method === "GET") {
        const calendar = decodeURIComponent(match[1]), id = decodeURIComponent(match[2]);
        reads.push({ calendar, id, fresh: true });
        if (masterLookupError) throw new Error(`visio_google_api_failed:${masterLookupError}:synthetic_lookup_failure`);
        const event = events(calendar).get(id);
        if (!event) throw new Error("visio_google_api_failed:404:not_found");
        return structuredClone(event);
      }
      const body = JSON.parse(String(init.body)) as Event;
      const request = { calendar: decodeURIComponent(match[1]), id: match[2] ? decodeURIComponent(match[2]) : String(body.id), method: init.method!, body, headers: Object.fromEntries(new Headers(init.headers)) };
      writes.push(request); await beforeWrite?.(request);
      const existing = events(request.calendar).get(request.id);
      if (request.method === "POST") {
        if (existing) throw new Error("visio_google_api_failed:409:already_exists");
        return seed(request.calendar, body);
      }
      assert.equal(request.method, "PATCH"); assert.ok(existing);
      if (request.headers["if-match"] && request.headers["if-match"] !== existing.etag) throw new Error("visio_google_api_failed:412:version_changed");
      return seed(request.calendar, { ...existing, ...body });
    },
    console: { error: () => assert.fail("The fixture cleanup must not fail") },
  };
  const exports = {} as { fixture: Api };
  new Function("exports", ...Object.keys(boundaries), compiled)(exports, ...Object.values(boundaries));
  const api = exports.fixture;
  const bookingToken = tokenApi.createVisioBookingToken({ userId, email });
  const claims = tokenApi.verifyVisioBookingToken(bookingToken);
  const masterId = api.bookingEventId(claims.nonce), pendingId = pending.pendingSignupReminderEventId(userId);
  const booked = (id = masterId): Event => ({ id, status: "confirmed", summary: "Confirmed appointment", colorId: "9",
    extendedProperties: { private: { inrcyBooking: "signup-visio", prospectUserId: userId, bookingNonce: claims.nonce, inrcyAppointmentStatus: "appointment_scheduled_direct", inrcyAppointmentOrigin: "signup_with_appointment" } } });
  const completeBooking = () => { seed(publicCalendar, booked()); return seed(shared, booked("existing-booked-mirror")); };
  return { api, bookingToken, claims, masterId, pendingId, writes, reads, seed, booked, completeBooking,
    run: () => api.ensurePendingSignupCalendarReminder({ ...input, bookingToken }),
    onWrite: (callback: typeof beforeWrite) => { beforeWrite = callback; },
    failMasterLookup: (status: number) => { masterLookupError = status; },
    get: (calendar: string, id: string) => structuredClone(events(calendar).get(id)),
  };
}

test("a booking completed before its late reminder never creates or restores an orange event", async () => {
  const f = fixture(), blue = f.completeBooking();
  assert.deepEqual(await f.run(), { status: "existing", eventId: f.masterId });
  assert.equal(f.writes.length, 0); assert.deepEqual(f.get(shared, blue.id!), blue);
  assert.ok(f.reads.filter(read => read.calendar === publicCalendar).every(read => read.fresh));
});

test("a reminder completed first is still removed by the existing successful booking cleanup", async () => {
  const f = fixture(); assert.equal((await f.run()).status, "created");
  const blue = f.completeBooking();
  const confirmation = { synthetic: true };
  assert.deepEqual(await f.api.finalizeBookedVisio(f.claims, confirmation), confirmation);
  assert.equal(f.get(shared, f.pendingId)?.status, "cancelled");
  assert.deepEqual(f.get(shared, blue.id!), blue);
});

test("a booking wins while reminder creation is suspended: only the late orange event is conditionally cancelled", async () => {
  const f = fixture(); let release!: () => void, started!: () => void;
  const suspended = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  f.onWrite(async request => { if (request.method === "POST") { started(); await suspended; } });
  const reminder = f.run(); await entered;
  const blue = f.completeBooking();
  await f.api.finalizeBookedVisio(f.claims, {});
  release(); assert.deepEqual(await reminder, { status: "existing", eventId: f.masterId });
  assert.equal(f.get(shared, f.pendingId)?.status, "cancelled"); assert.deepEqual(f.get(shared, blue.id!), blue);
  const cancellation = f.writes.find(write => write.method === "PATCH")!;
  assert.equal(cancellation.id, f.pendingId); assert.ok(cancellation.headers["if-match"]);
  const before = f.writes.length; await f.run(); assert.equal(f.writes.length, before, "replaying the reminder cannot recreate it");
  assert.equal(JSON.stringify(f.writes).includes(f.bookingToken), false, "the booking receipt never reaches Calendar");
});

test("a pending event converted into a real appointment before cleanup is preserved by If-Match", async () => {
  const f = fixture(); let converted: Event | undefined;
  f.onWrite(request => {
    if (request.method === "POST") f.completeBooking();
    if (request.method === "PATCH") converted = f.seed(shared, f.booked(f.pendingId));
  });
  assert.equal((await f.run()).status, "existing"); assert.ok(converted);
  assert.deepEqual(f.get(shared, f.pendingId), converted); assert.equal(converted.status, "confirmed");
  assert.ok(f.writes.find(write => write.method === "PATCH")?.headers["if-match"]);
});

test("replaying a new signup never restores a cancelled reminder even without a visible booking", async () => {
  const f = fixture();
  const cancelled = { ...pending.buildPendingSignupReminderCalendarEvent({ ...input, calendarId: shared }), status: "cancelled" };
  cancelled.extendedProperties.private[mirror.TEAM_CALENDAR_AUTOMATION_SNAPSHOT_KEY] = mirror.teamCalendarAutomationSnapshot(cancelled);
  const before = f.seed(shared, cancelled);
  assert.equal((await f.run()).status, "existing");
  assert.deepEqual(f.get(shared, f.pendingId), before); assert.equal(f.writes.length, 0);
});

test("a concurrent reminder insert conflict is reconciled without creating a second pending event", async () => {
  const f = fixture();
  f.onWrite(request => {
    if (request.method === "POST") { f.seed(shared, request.body); f.completeBooking(); }
  });
  assert.equal((await f.run()).status, "existing");
  assert.equal(f.get(shared, f.pendingId)?.status, "cancelled");
  assert.equal(f.writes.filter(write => write.method === "POST").length, 1);
});

test("wrong receipts, foreign calendar ownership and manual pending edits never authorize cancellation", async () => {
  for (const patch of [{ userId: "other-user" }, { email: "other@example.invalid" }, { bookingToken: "forged" }, { bookingToken: "" }]) {
    const f = fixture(); await assert.rejects(f.api.ensurePendingSignupCalendarReminder({ ...input, bookingToken: f.bookingToken, ...patch }));
    assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
  }
  const foreign = fixture();
  const event = foreign.seed(shared, { ...pending.buildPendingSignupReminderCalendarEvent({ ...input, calendarId: shared }), extendedProperties: { private: { prospectUserId: "other-user" } } });
  await assert.rejects(foreign.run(), /event_id_conflict/); assert.deepEqual(foreign.get(shared, foreign.pendingId), event); assert.equal(foreign.writes.length, 0);
  const manual = fixture();
  // A human edit between the insert and its follow-up read must survive.
  const originalSeed = manual.seed;
  manual.onWrite(request => {
    if (request.method === "POST") {
      manual.completeBooking();
      const body = { ...request.body, summary: "Human edited reminder" };
      originalSeed(shared, body);
    }
  });
  await manual.run(); assert.equal(manual.get(shared, manual.pendingId)?.summary, "Human edited reminder");
  assert.equal(manual.writes.filter(write => write.method === "PATCH").length, 0);
});

test("master lookup failures other than a real 404 never create or restore a pending reminder", async () => {
  for (const status of [401, 403, 410, 429, 500]) {
    for (const existing of [false, true]) {
      const f = fixture();
      if (existing) f.seed(shared, { ...pending.buildPendingSignupReminderCalendarEvent({ ...input, calendarId: shared }), status: "cancelled" });
      f.failMasterLookup(status);
      await assert.rejects(f.run(), new RegExp(`visio_google_api_failed:${status}:`));
      assert.equal(f.writes.length, 0, `HTTP ${status} cannot authorize a Calendar mutation`);
    }
  }
  const f = fixture(); f.seed(publicCalendar, { ...f.booked(), status: "cancelled" });
  await assert.rejects(f.run(), /booking_cancelled/); assert.equal(f.writes.length, 0);
});
