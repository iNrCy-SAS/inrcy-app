import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as eventPolicy from "../../lib/visioBookingEventPolicy.ts";
import * as lifecycle from "../../lib/visioAppointmentLifecycle.ts";
import * as identity from "../../lib/visioAppointmentIdentity.ts";
import * as delivery from "../../lib/visioBookingDeliveryPolicy.ts";
import * as mirrorPolicy from "../../lib/visioCalendarMirrorPolicy.ts";
import * as bookingPolicy from "../../lib/visioBookingPolicy.ts";
import * as pendingPolicy from "../../lib/visioPendingSignupPolicy.ts";
import * as retryPolicy from "../../lib/googleCalendarRetryPolicy.ts";
import * as tokenScope from "../../lib/visioGoogleTokenScope.ts";
import * as eventScope from "../../lib/visioCalendarEventScope.ts";

type Event = mirrorPolicy.TeamCalendarEvent & { guestsCanInviteOthers?: boolean; guestsCanModify?: boolean; guestsCanSeeOtherGuests?: boolean };
type Member = bookingPolicy.VisioTeamMember;
type SyncResult = {
  ok: boolean;
  locked: boolean;
  errors: Array<{ memberId: string; code: string }>;
  reconciliation: { replicaFanouts: number };
};
type Request = {
  method: string;
  calendarId: string;
  eventId: string;
  body?: Record<string, unknown>;
  query: Record<string, string>;
};
type HarnessModule = {
  getVisioTeamMembers(): Member[];
  syncVisioTeamCalendarsToShared(input: { now: Date }): Promise<SyncResult>;
  updateVisioTeamAppointmentStatus(input: { mirrorEventId: string; status: lifecycle.VisioAppointmentStatus; actor: { userId: string; email: string; name: string } }): Promise<{ status: lifecycle.VisioAppointmentStatus; notificationsSent: boolean }>;
  __fixtures: {
    managedCalendarReplicaBody(event: Event, member: Member): Event;
    withTeamCalendarAutomationSnapshot(event: Event): Event;
    teamMirrorEventId(calendarId: string, eventId: string): string;
    teamMirrorFingerprint(event: Event, member: Member): string;
  };
};

const sharedCalendarId = "shared@example.test";
const now = new Date("2026-10-04T12:00:00.000Z");
const nativeRequire = createRequire(import.meta.url);
const sourcePath = new URL("../../lib/visioBookingGoogle.ts", import.meta.url);
const clientCompiled = ts.transpileModule(readFileSync(new URL("../../lib/visioGoogleCalendarClient.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Only external boundaries are mocked. The synchronizer, reconciliation,
// mutation wrappers, caches, and all policy modules execute their actual code.
const compiled = ts.transpileModule(
  `${readFileSync(sourcePath, "utf8")}\nexport const __fixtures = {
    managedCalendarReplicaBody, withTeamCalendarAutomationSnapshot,
    teamMirrorEventId, teamMirrorFingerprint,
  };`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function mergePatch(before: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
  const result: Record<string, unknown> = before && typeof before === "object"
    ? structuredClone(before) as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

function createHarness(syncNow = now) {
  const calendars = new Map<string, Map<string, Event>>();
  const hiddenFromListings = new Set<string>();
  const requests: Request[] = [];
  const databaseWrites: Array<{ table: string; value: unknown }> = [];
  const auditEvents: Record<string, unknown>[] = [];
  let auditReadError = false;
  let professionalCompany = "Test Company";
  const missingStatuses = new Map<string, number>();
  const env: Record<string, string> = {
    INRCY_VISIO_SHARED_CALENDAR_ID: sharedCalendarId,
    INRCY_VISIO_PUBLIC_CALENDAR_ID: "jimmy@inrcy.com",
    INRCY_VISIO_OCEANE_EMAIL: "oceane@inrcy.com",
    INRCY_VISIO_OCEANE_CALENDAR_ID: "oceane@inrcy.com",
    INRCY_VISIO_APOLLINE_EMAIL: "apolline@inrcy.com",
    INRCY_VISIO_APOLLINE_CALENDAR_ID: "apolline@inrcy.com",
    INRCY_VISIO_JIMMY_EMAIL: "jimmy@inrcy.com",
    INRCY_VISIO_JIMMY_CALENDAR_ID: "jimmy@inrcy.com",
  };
  const calendar = (calendarId: string) => {
    if (!calendars.has(calendarId)) calendars.set(calendarId, new Map());
    return calendars.get(calendarId)!;
  };
  const responseEvent = (event: Event) => {
    const result = structuredClone(event);
    if (!result.location) delete result.location;
    if (result.visibility === "default") delete result.visibility;
    if (result.transparency === "opaque") delete result.transparency;
    if (result.reminders?.overrides?.length === 0) delete result.reminders.overrides;
    return result;
  };
  const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const fetchGoogle = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://www.googleapis.com", "the harness never accesses the network");
    const match = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    assert.ok(match, `unexpected Calendar endpoint: ${url.pathname}`);
    const calendarId = decodeURIComponent(match[1]);
    const eventId = match[2] ? decodeURIComponent(match[2]) : "";
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, calendarId, eventId, body, query: Object.fromEntries(url.searchParams) });
    const events = calendar(calendarId);
    if (method === "GET" && !eventId) {
      const items = [...events.values()].filter((event) => {
        if (hiddenFromListings.has(`${calendarId}\n${event.id}`)) return false;
        if (event.status === "cancelled" && url.searchParams.get("showDeleted") !== "true") return false;
        const property = url.searchParams.get("privateExtendedProperty");
        if (property) {
          const separator = property.indexOf("=");
          if (event.extendedProperties?.private?.[property.slice(0, separator)] !== property.slice(separator + 1)) return false;
        }
        return true;
      });
      return jsonResponse({ items: items.map(responseEvent) });
    }
    if (method === "GET") {
      const event = events.get(eventId);
      return event ? jsonResponse(responseEvent(event)) : jsonResponse({ error: { message: "missing" } }, missingStatuses.get(`${calendarId}\n${eventId}`) || 404);
    }
    if (method === "PATCH") {
      const current = events.get(eventId);
      if (!current) return jsonResponse({ error: { message: "missing" } }, 404);
      const updated = mergePatch(current, body) as Event;
      updated.updated = syncNow.toISOString();
      events.set(eventId, updated);
      return jsonResponse(responseEvent(updated));
    }
    if (method === "POST" && !eventId) {
      const id = String(body?.id || "");
      assert.ok(id, "inserts must retain deterministic ids");
      if (events.has(id)) return jsonResponse({ error: { message: "already exists" } }, 409);
      const created = { ...body, id, organizer: { email: calendarId }, updated: syncNow.toISOString() } as Event;
      events.set(id, created);
      return jsonResponse(responseEvent(created));
    }
    throw new Error(`unexpected Calendar operation: ${method} ${url.pathname}`);
  };
  const database = {
    auth: { admin: { async getUserById(userId: string) { return { data: { user: userId === "11111111-1111-4111-8111-111111111111" ? { id: userId, email: "jimmy@inrcy.com" } : null }, error: null }; } } },
    from(table: string) {
      assert.ok(["integrations", "profiles", "app_events"].includes(table), `unexpected database table: ${table}`);
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const result = () => ({ data: table === "app_events" ? auditReadError ? null : auditEvents.filter((row) => filters.every((filter) => filter(row))) : [], error: auditReadError && table === "app_events" ? { code: "TEST_READ_UNAVAILABLE" } : null });
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) {
          if (table === "app_events") filters.push((row) => {
            if (field.startsWith("payload->>")) return (row.payload as Record<string, unknown>)?.[field.slice(10)] === value;
            return row[field] === value;
          });
          return query;
        },
        contains(field: string, value: Record<string, unknown>) {
          if (table === "app_events") filters.push((row) => Object.entries(value).every(([key, expected]) => (row[field] as Record<string, unknown>)?.[key] === expected));
          return query;
        },
        order() { return query; },
        limit() { return query; },
        async insert(value: unknown) { databaseWrites.push({ table, value: structuredClone(value) }); if (table === "app_events") auditEvents.push(structuredClone(value) as Record<string, unknown>); return { error: null }; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve(result())); },
        async maybeSingle() {
          if (table === "app_events") { const value = result(); return { ...value, data: value.data?.[0] || null }; }
          return {
            error: null,
            data: table === "integrations"
              ? { id: "integration", user_id: "staff", access_token_enc: "test-token", expires_at: "2099-01-01T00:00:00Z" }
              : { first_name: "Test", last_name: "Professional", contact_email: "client@example.test", company_legal_name: professionalCompany, phone: "0102030405" },
          };
        },
      };
      return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@upstash/redis": { Redis: class { constructor() { throw new Error("Redis must remain mocked"); } } },
    "@/lib/oauthCrypto": { encryptToken: (value: string) => value, tryDecryptToken: (value: string) => value },
    "@/lib/env": {
      optionalEnv: (key: string, fallback: string) => env[key] ?? fallback,
      requireEnv: (key: string) => { assert.ok(env[key], `missing test env: ${key}`); return env[key]; },
    },
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/roles": { ADMIN_USER_IDS: [] },
    "@/lib/txMailer": { sendTxMail: () => { throw new Error("unexpected email"); } },
    "@/lib/visioGoogleTokenScope": tokenScope,
    "@/lib/visioCalendarEventScope": eventScope,
    "@/lib/visioBookingInternalAlert": {},
    "@/lib/visioBookingConfirmation": {},
    "@/lib/executionIdempotency": {},
    "@/lib/googleCalendarRetryPolicy": retryPolicy,
    "@/lib/visioBookingEventPolicy": eventPolicy,
    "@/lib/visioAppointmentLifecycle": lifecycle,
    "@/lib/visioAppointmentIdentity": identity,
    "@/lib/visioBookingDeliveryPolicy": delivery,
    "@/lib/visioCalendarMirrorPolicy": mirrorPolicy,
    "@/lib/visioBookingPolicy": bookingPolicy,
    "@/lib/visioPendingSignupPolicy": pendingPolicy,
  };
  const exports = {} as HarnessModule;
  const runtimeContext = {
    exports,
    require: (name: string) => {
      if (name.startsWith("node:")) return nativeRequire(name);
      assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
      return dependencies[name];
    },
    fetch: fetchGoogle,
    process: { env: { NODE_ENV: "test" } },
    console: { info() {}, warn() {}, error() {} },
    Date, Error, URL, URLSearchParams, structuredClone, setTimeout, clearTimeout,
  };
  const clientExports = {};
  runInNewContext(clientCompiled, { ...runtimeContext, exports: clientExports }, { filename: "visioGoogleCalendarClient.convergence.cjs" });
  dependencies["@/lib/visioGoogleCalendarClient"] = clientExports;
  runInNewContext(compiled, runtimeContext, { filename: "visioBookingGoogle.convergence.cjs" });
  return {
    api: exports,
    members: exports.getVisioTeamMembers(),
    requests,
    databaseWrites,
    auditEvents,
    setAuditReadError(value: boolean) { auditReadError = value; },
    setProfessionalCompany(value: string) { professionalCompany = value; },
    seed(calendarId: string, event: Event, hidden = false) {
      assert.ok(event.id);
      calendar(calendarId).set(event.id, structuredClone(event));
      if (hidden) hiddenFromListings.add(`${calendarId}\n${event.id}`);
    },
    get(calendarId: string, eventId: string) {
      return structuredClone(calendar(calendarId).get(eventId));
    },
    remove(calendarId: string, eventId: string, status = 404) {
      calendar(calendarId).delete(eventId);
      missingStatuses.set(`${calendarId}\n${eventId}`, status);
    },
    events(calendarId: string) { return structuredClone([...calendar(calendarId).values()]); },
    externalEdit(calendarId: string, eventId: string, patch: Partial<Event>) {
      const current = calendar(calendarId).get(eventId);
      assert.ok(current);
      calendar(calendarId).set(eventId, mergePatch(current, patch) as Event);
    },
    async runSync(options?: { allowErrors?: boolean }) {
      const firstRequest = requests.length;
      const result = await exports.syncVisioTeamCalendarsToShared({ now: syncNow });
      assert.equal(result.locked, false);
      if (!options?.allowErrors) assert.equal(result.ok, true, JSON.stringify(result.errors));
      const passRequests = requests.slice(firstRequest);
      return { result, requests: passRequests, writes: passRequests.filter((request) => request.method !== "GET") };
    },
  };
}

function seedPendingFamily(harness: ReturnType<typeof createHarness>) {
  const pending = pendingPolicy.buildPendingSignupReminderCalendarEvent({
    userId: "prospect-convergence", calendarId: sharedCalendarId,
    createdAt: "2026-10-04T09:00:00.000Z", firstName: "Test", lastName: "Professional",
    email: "client@example.test", company: "Test Company", phone: "0102030405",
  });
  const canonical = harness.api.__fixtures.withTeamCalendarAutomationSnapshot({
    ...pending,
    organizer: { email: sharedCalendarId },
    extendedProperties: { private: {
      ...pending.extendedProperties.private,
      assignedMemberId: harness.members[0].id,
      assignedMemberEmail: harness.members[0].email,
    } },
  });
  harness.seed(sharedCalendarId, canonical);
  const replicas = harness.members.map((member) => {
    const replica = harness.api.__fixtures.managedCalendarReplicaBody(canonical, member);
    harness.seed(member.calendarId, replica);
    return { member, replica };
  });
  return { canonical, replicas };
}

function seedScheduledFamily(harness: ReturnType<typeof createHarness>) {
  const { canonical: pending } = seedPendingFamily(harness);
  const canonical = harness.api.__fixtures.withTeamCalendarAutomationSnapshot({
    ...pending,
    status: "confirmed",
    summary: "Inscription iNrCy - Entreprise de test",
    colorId: "9",
    start: { dateTime: "2026-10-06T09:00:00.000Z", timeZone: "Europe/Paris" },
    end: { dateTime: "2026-10-06T09:45:00.000Z", timeZone: "Europe/Paris" },
    description: `${pending.description}\nGoogle Meet : https://meet.google.com/abc-defg-hij`,
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] },
    attendees: [{ email: "client@example.test" }],
    reminders: { useDefault: false, overrides: [] },
    guestsCanInviteOthers: false, guestsCanModify: false, guestsCanSeeOtherGuests: false,
    extendedProperties: { private: {
      ...pending.extendedProperties?.private,
      ...lifecycle.lifecyclePrivateProperties({ status: "appointment_scheduled_direct", origin: "signup_with_appointment" }),
      inrcyBooking: "signup-visio",
      sourceMeetUrl: "https://meet.google.com/abc-defg-hij",
    } },
  });
  harness.seed(sharedCalendarId, canonical);
  const replicas = harness.members.map((member) => {
    const replica = harness.api.__fixtures.managedCalendarReplicaBody(canonical, member);
    harness.seed(member.calendarId, replica);
    return { member, replica };
  });
  return { canonical, replicas };
}

function assertScheduled(event: Event | undefined) {
  assert.ok(event, "a scheduled appointment must remain recoverable");
  assert.equal(event.status, "confirmed");
  assert.equal(event.colorId, "9");
  assert.equal(event.extendedProperties?.private?.inrcyAppointmentStatus, "appointment_scheduled_direct");
  assert.equal(mirrorPolicy.teamCalendarEventMeetUrl(event), "https://meet.google.com/abc-defg-hij");
}

function assertNoInferredBusinessCancellation(requests: Request[]) {
  for (const request of requests.filter((value) => value.method !== "GET")) {
    const body = request.body as Event;
    assert.notEqual(body.extendedProperties?.private?.inrcyAppointmentStatus, "appointment_cancelled");
    assert.notEqual(body.extendedProperties?.private?.inrcyAppointmentStatus, "signup_cancelled");
    assert.notEqual(body.colorId, "11");
    assert.equal(request.query.sendUpdates, "none", "automatic repair must never notify the prospect");
  }
}

test("full sync leaves a stable pending signup and three frozen replicas unchanged", async () => {
  const harness = createHarness();
  seedPendingFamily(harness);
  assert.deepEqual((await harness.runSync()).writes, []);
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("already cancelled canonical and three cancelled replicas require no further PATCH", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedPendingFamily(harness);
  harness.externalEdit(sharedCalendarId, canonical.id!, { status: "cancelled" });
  for (const { member, replica } of replicas) harness.externalEdit(member.calendarId, replica.id!, { status: "cancelled" });
  for (let pass = 0; pass < 2; pass += 1) {
    const result = await harness.runSync();
    assert.deepEqual(result.writes, []);
    assert.ok(result.requests.every((request) => !request.eventId), "complete cancelled snapshots need no per-event GETs");
  }
});

test("a cancelled canonical cancels only its still-active replica and the next sync converges", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedPendingFamily(harness);
  harness.externalEdit(sharedCalendarId, canonical.id!, { status: "cancelled" });
  for (const { member, replica } of replicas.slice(1)) harness.externalEdit(member.calendarId, replica.id!, { status: "cancelled" });
  const first = await harness.runSync();
  assert.deepEqual(first.writes.map(({ calendarId, eventId, body }) => ({ calendarId, eventId, status: body?.status })), [
    { calendarId: replicas[0].member.calendarId, eventId: replicas[0].replica.id, status: "cancelled" },
  ]);
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("one stripped replica tombstone cancels the pending family once and remains cancelled next sync", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedPendingFamily(harness);
  const deleted = replicas[0];
  harness.seed(deleted.member.calendarId, { id: deleted.replica.id, status: "cancelled" });
  const first = await harness.runSync();
  assert.equal(first.writes.length, 3, JSON.stringify(first.writes));
  assert.ok(first.writes.every((request) => request.method === "PATCH" && request.body?.status === "cancelled"));
  assert.equal(new Set(first.writes.map((request) => `${request.calendarId}/${request.eventId}`)).size, 3);
  assert.equal(harness.get(sharedCalendarId, canonical.id!)?.status, "cancelled");
  assert.ok(replicas.every(({ member, replica }) => harness.get(member.calendarId, replica.id!)?.status === "cancelled"));
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("cancellation checks an unlisted replica before writing and does not treat absence as deletion", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedPendingFamily(harness);
  harness.externalEdit(sharedCalendarId, canonical.id!, { status: "cancelled" });
  const outside = replicas[2];
  harness.seed(outside.member.calendarId, outside.replica, true);
  for (const { member, replica } of replicas.slice(0, 2)) harness.externalEdit(member.calendarId, replica.id!, { status: "cancelled" });
  const first = await harness.runSync();
  assert.ok(first.requests.some((request) => request.method === "GET" && request.calendarId === outside.member.calendarId && request.eventId === outside.replica.id));
  assert.equal(first.writes.length, 1);
  assert.equal(first.writes[0].calendarId, outside.member.calendarId);
  assert.equal(harness.get(outside.member.calendarId, outside.replica.id!)?.status, "cancelled");
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("a cancelled family also removes an active legacy replica with a different id", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedPendingFamily(harness);
  harness.externalEdit(sharedCalendarId, canonical.id!, { status: "cancelled" });
  for (const { member, replica } of replicas) harness.externalEdit(member.calendarId, replica.id!, { status: "cancelled" });
  const legacy = { ...replicas[2].replica, id: "legacy-replica-id" };
  harness.seed(replicas[2].member.calendarId, legacy);
  const first = await harness.runSync();
  assert.deepEqual(first.writes.map(({ calendarId, eventId, body }) => ({ calendarId, eventId, status: body?.status })), [
    { calendarId: replicas[2].member.calendarId, eventId: legacy.id, status: "cancelled" },
  ]);
  assert.equal(harness.get(replicas[2].member.calendarId, legacy.id)?.status, "cancelled");
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("an explicitly missing canonical cancels its active signup replicas without writing a missing resource", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedPendingFamily(harness);
  harness.remove(sharedCalendarId, canonical.id!);
  const first = await harness.runSync();
  assert.equal(first.requests.filter((request) => request.method === "GET" && request.calendarId === sharedCalendarId && request.eventId === canonical.id).length, 1);
  assert.equal(first.writes.length, 3);
  assert.ok(first.writes.every((request) => request.calendarId !== sharedCalendarId && request.body?.status === "cancelled"));
  assert.ok(replicas.every(({ member, replica }) => harness.get(member.calendarId, replica.id!)?.status === "cancelled"));
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("a genuine move in one scheduled replica survives the two later frozen snapshots and the next sync", async () => {
  const harness = createHarness();
  const { canonical: pending } = seedPendingFamily(harness);
  const canonical = harness.api.__fixtures.withTeamCalendarAutomationSnapshot({
    ...pending,
    colorId: lifecycle.visioAppointmentColorId("appointment_scheduled_direct"),
    extendedProperties: { private: {
      ...pending.extendedProperties?.private,
      ...lifecycle.lifecyclePrivateProperties({ status: "appointment_scheduled_direct", origin: "signup_with_appointment" }),
      inrcyBooking: "signup-visio",
    } },
  });
  harness.seed(sharedCalendarId, canonical);
  const replicas = harness.members.map((member) => {
    const replica = harness.api.__fixtures.managedCalendarReplicaBody(canonical, member);
    harness.seed(member.calendarId, replica);
    return { member, replica };
  });
  const movedSchedule = {
    start: { dateTime: "2026-10-06T13:00:00.000Z", timeZone: "Europe/Paris" },
    end: { dateTime: "2026-10-06T14:00:00.000Z", timeZone: "Europe/Paris" },
  };
  harness.externalEdit(replicas[0].member.calendarId, replicas[0].replica.id!, movedSchedule);
  const first = await harness.runSync();
  assert.ok(first.writes.length > 0, "the external move must be propagated");
  assert.equal(new Set(first.writes.map((request) => `${request.calendarId}/${request.eventId}`)).size, first.writes.length,
    "later frozen member snapshots must not undo or repeat the earlier update");
  for (const [calendarId, id] of [
    [sharedCalendarId, canonical.id!],
    ...replicas.map(({ member, replica }) => [member.calendarId, replica.id!] as const),
  ]) {
    const event = harness.get(calendarId, id)!;
    assert.deepEqual(event.start, movedSchedule.start);
    assert.deepEqual(event.end, movedSchedule.end);
    assert.equal(event.extendedProperties?.private?.inrcyAppointmentStatus, "appointment_scheduled_direct");
  }
  assert.deepEqual((await harness.runSync()).writes, []);
});

for (const missingStatus of [404, 410]) {
  test(`a scheduled canonical missing with Google ${missingStatus} is recovered as scheduled without cancelling its family`, async () => {
    const harness = createHarness();
    const { canonical } = seedScheduledFamily(harness);
    harness.remove(sharedCalendarId, canonical.id!, missingStatus);
    const first = await harness.runSync();
    assertNoInferredBusinessCancellation(first.requests);
    const active = harness.events(sharedCalendarId).filter((event) => event.status !== "cancelled");
    assert.equal(active.length, 1, "one recoverable scheduled canonical, without duplicates");
    assertScheduled(active[0]);
    for (const member of harness.members) {
      const copies = harness.events(member.calendarId).filter((event) => event.status !== "cancelled");
      assert.equal(copies.length, 1);
      assertScheduled(copies[0]);
    }
    assert.deepEqual((await harness.runSync()).writes, [], "the recovery and all replica fingerprints converge");
  });
}

test("a stripped scheduled replica tombstone never cancels the canonical or the other two replicas", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedScheduledFamily(harness);
  harness.seed(replicas[0].member.calendarId, { id: replicas[0].replica.id, status: "cancelled" });
  const first = await harness.runSync();
  assertNoInferredBusinessCancellation(first.requests);
  assertScheduled(harness.get(sharedCalendarId, canonical.id!));
  for (const { member, replica } of replicas) assertScheduled(harness.get(member.calendarId, replica.id!));
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("a colour-only red edit in one scheduled replica is repaired across the family without a cancellation", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedScheduledFamily(harness);
  harness.externalEdit(replicas[0].member.calendarId, replicas[0].replica.id!, { colorId: "11" });
  const first = await harness.runSync();
  assertNoInferredBusinessCancellation(first.requests);
  assertScheduled(harness.get(sharedCalendarId, canonical.id!));
  for (const { member, replica } of replicas) assertScheduled(harness.get(member.calendarId, replica.id!));
  assert.deepEqual((await harness.runSync()).writes, []);
});

function seedTonySourceAndMirror(harness: ReturnType<typeof createHarness>) {
  harness.setProfessionalCompany("Les Voies de la Guérison");
  const publicMember = harness.members.find((member) => member.id === "jimmy")!;
  const source: Event = {
    id: "original-tony", status: "confirmed", summary: "Inscription iNrCy - Les Voies de la Guérison", colorId: "9",
    created: "2026-11-04T04:15:56.000Z", updated: "2026-11-04T04:15:57.260Z",
    description: "Nom : Professional\nPrénom : Test\nE-mail : client@example.test\nEntreprise : Les Voies de la Guérison\nTéléphone : 0102030405\nGoogle Meet : https://meet.google.com/abc-defg-hij",
    start: { dateTime: "2026-11-09T11:00:00+01:00", timeZone: "Europe/Paris" },
    end: { dateTime: "2026-11-09T11:45:00+01:00", timeZone: "Europe/Paris" },
    organizer: { email: publicMember.calendarId },
    attendees: [{ email: "client@example.test" }],
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] },
    reminders: { useDefault: false, overrides: [] },
    guestsCanInviteOthers: false, guestsCanModify: false, guestsCanSeeOtherGuests: false,
    extendedProperties: { private: {
      inrcyBooking: "signup-visio", inrcyLogicalAppointmentId: "prospect:tony-fixture", prospectUserId: "tony-fixture",
      sourceCalendarId: publicMember.calendarId, sourceEventId: "original-tony", sourceMeetUrl: "https://meet.google.com/abc-defg-hij", assignedMemberId: "oceane",
      ...lifecycle.lifecyclePrivateProperties({ status: "appointment_scheduled_direct", origin: "signup_with_appointment" }),
    } },
  };
  const mirror = mirrorPolicy.buildTeamCalendarMirrorBody({
    event: source, member: publicMember, sharedCalendarId,
    mirrorEventId: harness.api.__fixtures.teamMirrorEventId(publicMember.calendarId, source.id!),
    fingerprint: harness.api.__fixtures.teamMirrorFingerprint(source, publicMember),
  });
  const corrupted = harness.api.__fixtures.withTeamCalendarAutomationSnapshot({
    ...mirror, colorId: "11", updated: "2026-11-04T09:33:44.398Z",
    guestsCanInviteOthers: false, guestsCanModify: false, guestsCanSeeOtherGuests: false,
    extendedProperties: { private: { ...mirror.extendedProperties.private, inrcyAppointmentStatus: "appointment_cancelled", assignedMemberId: "oceane", assignedMemberEmail: "oceane@inrcy.com" } },
  });
  harness.seed(publicMember.calendarId, source);
  harness.seed(sharedCalendarId, corrupted);
  return { source, mirror: corrupted, publicMember };
}

test("Tony's ambiguous legacy red mirror stays unchanged until an explicit human reopening converges with the blue original", async () => {
  const harness = createHarness(new Date("2026-11-06T14:00:00Z"));
  const { source, mirror, publicMember } = seedTonySourceAndMirror(harness);
  const first = await harness.runSync();
  assert.deepEqual(first.writes, [], "absence of audit cannot disprove a historical human cancellation");
  const held = harness.get(sharedCalendarId, mirror.id!);
  assert.equal(held?.colorId, "11");
  assert.equal(held?.extendedProperties?.private?.inrcyAppointmentStatus, "appointment_cancelled");
  assert.equal(lifecycle.hasExplicitVisioAppointmentCancellation(held!), false);
  assertScheduled(harness.get(publicMember.calendarId, source.id!));
  assert.deepEqual((await harness.runSync()).writes, []);
  const result = await harness.api.updateVisioTeamAppointmentStatus({ mirrorEventId: mirror.id!, status: "appointment_scheduled_direct", actor: { userId: "11111111-1111-4111-8111-111111111111", email: "jimmy@inrcy.com", name: "Staff Human" } });
  assert.equal(result.status, "appointment_scheduled_direct");
  assert.equal(result.notificationsSent, false);
  const repaired = harness.get(sharedCalendarId, mirror.id!);
  assertScheduled(repaired);
  assert.equal(repaired?.extendedProperties?.private?.assignedMemberId, "oceane", "the hosting Google calendar cannot silently reassign the responsible member");
  assertScheduled(harness.get(publicMember.calendarId, source.id!));
  assert.equal(repaired?.extendedProperties?.private?.sourceEventId, source.id);
  assert.deepEqual(repaired?.conferenceData, source.conferenceData, "no second Meet is created or substituted");
  assert.equal(repaired?.reminders?.useDefault, false);
  assert.equal(repaired?.guestsCanInviteOthers, false);
  assert.equal(repaired?.guestsCanModify, false);
  assert.equal(repaired?.guestsCanSeeOtherGuests, false);
  const beforeSync = new Map([sharedCalendarId, ...harness.members.map((member) => member.calendarId)].flatMap((calendarId) => harness.events(calendarId).map((event) => [`${calendarId}/${event.id}`, event] as const)));
  const next = await harness.runSync();
  const diff = next.writes.map((request) => {
    const before = beforeSync.get(`${request.calendarId}/${request.eventId}`) as unknown as Record<string, unknown> | undefined;
    const changed = Object.entries(request.body || {}).filter(([key, value]) => JSON.stringify(before?.[key]) !== JSON.stringify(value)).map(([key]) => key);
    const privateBefore = (before?.extendedProperties as Event["extendedProperties"])?.private || {};
    const privateAfter = (request.body as Event)?.extendedProperties?.private || {};
    const result = { calendarId: request.calendarId, eventId: request.eventId, changed, privateChanged: Object.entries(privateAfter).filter(([key, value]) => privateBefore[key] !== value).map(([key]) => key),
      ...(request.calendarId === sharedCalendarId ? { beforeSummary: before?.summary, afterSummary: request.body?.summary ?? before?.summary, assignment: ["assignedMemberId", "assignedMemberEmail", "sourceFingerprint"].map((key) => ({ key, before: privateBefore[key], after: privateAfter[key] ?? privateBefore[key] })) } : {}),
    };
    beforeSync.set(`${request.calendarId}/${request.eventId}`, mergePatch(before, request.body) as Event);
    return result;
  });
  assert.equal(next.writes.length, 0, JSON.stringify(diff));
});

test("duplicate cleanup preserves an ambiguous red appointment and its preferred blue representation until a human decision", async () => {
  const harness = createHarness(new Date("2026-11-06T14:00:00Z"));
  const { source, mirror, publicMember } = seedTonySourceAndMirror(harness);
  assert.equal(mirrorPolicy.isTeamCalendarAutomationDetached(mirror), false);
  assert.equal(mirrorPolicy.hasTeamCalendarAutomationSnapshotDiverged(mirror), false);
  assert.equal(lifecycle.hasExplicitVisioAppointmentCancellation(mirror), false);
  const blue = harness.api.__fixtures.withTeamCalendarAutomationSnapshot({
    ...mirror,
    id: "tm-preferred-blue-duplicate",
    colorId: "9",
    updated: "2026-11-05T10:00:00.000Z",
    extendedProperties: { private: { ...mirror.extendedProperties?.private, inrcyAppointmentStatus: "appointment_scheduled_direct" } },
  });
  harness.seed(sharedCalendarId, blue);
  const originalRed = harness.get(sharedCalendarId, mirror.id!);
  for (let pass = 0; pass < 2; pass++) {
    const sync = await harness.runSync();
    assert.equal(sync.writes.some(request => request.calendarId === sharedCalendarId && request.eventId === mirror.id && request.body?.status === "cancelled"), false, "deduplication must not erase the only cancelled representation in favour of a blue duplicate");
    assert.deepEqual(sync.writes, [], "a mixed cancelled/scheduled family requires a human decision before any automatic write");
    assert.deepEqual(harness.get(sharedCalendarId, mirror.id!), originalRed, "the ambiguous cancellation remains intact without a human decision");
    assertScheduled(harness.get(sharedCalendarId, blue.id!));
    assertScheduled(harness.get(publicMember.calendarId, source.id!));
  }
});

test("an explicit authorized cancellation is audited and remains cancelled through full synchronization", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedScheduledFamily(harness);
  const result = await harness.api.updateVisioTeamAppointmentStatus({ mirrorEventId: canonical.id!, status: "appointment_cancelled", actor: { userId: "11111111-1111-4111-8111-111111111111", email: "jimmy@inrcy.com", name: "Staff Human" } });
  assert.equal(result.status, "appointment_cancelled");
  assert.equal(result.notificationsSent, false);
  assert.ok(harness.databaseWrites.some((write) => write.table === "app_events" && (write.value as { type?: string }).type === "appointment_status_changed"));
  for (const [calendarId, id] of [[sharedCalendarId, canonical.id!], ...replicas.map(({ member, replica }) => [member.calendarId, replica.id!] as const)]) {
    const event = harness.get(calendarId, id)!;
    assert.equal(event.status, "confirmed", "business cancellation preserves the visible appointment record");
    assert.equal(event.colorId, "11");
    assert.equal(event.extendedProperties?.private?.inrcyAppointmentStatus, "appointment_cancelled");
    assert.equal(event.extendedProperties?.private?.[lifecycle.VISIO_APPOINTMENT_MANUAL_CANCELLATION_KEY], lifecycle.VISIO_APPOINTMENT_MANUAL_CANCELLATION_VALUE);
    assert.equal(event.extendedProperties?.private?.[lifecycle.VISIO_APPOINTMENT_MANUAL_CANCELLATION_ACTOR_KEY], "11111111-1111-4111-8111-111111111111");
    assert.ok(event.extendedProperties?.private?.[lifecycle.VISIO_APPOINTMENT_MANUAL_CANCELLATION_AT_KEY]);
    assert.equal(mirrorPolicy.teamCalendarEventMeetUrl(event), "https://meet.google.com/abc-defg-hij");
  }
  assert.deepEqual((await harness.runSync()).writes, []);
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("an older human cancellation backed by its audit is preserved instead of resurrecting Tony's red mirror", async () => {
  const harness = createHarness(new Date("2026-11-06T14:00:00Z"));
  const { mirror } = seedTonySourceAndMirror(harness);
  harness.auditEvents.push({
    user_id: "11111111-1111-4111-8111-111111111111", module: "visio_booking_admin", type: "appointment_status_changed", created_at: "2026-11-04T09:33:44.398Z",
    payload: { mirrorEventId: mirror.id, previousStatus: "appointment_scheduled_direct", status: "appointment_cancelled", actorEmail: "jimmy@inrcy.com", actorName: "Staff Human", changedAt: "2026-11-04T09:33:44.398Z", notificationsSent: false },
  });
  const first = await harness.runSync();
  const retained = harness.get(sharedCalendarId, mirror.id!);
  assert.equal(retained?.colorId, "11");
  assert.equal(retained?.extendedProperties?.private?.inrcyAppointmentStatus, "appointment_cancelled");
  assert.equal(lifecycle.hasExplicitVisioAppointmentCancellation(retained!), false, "background reconciliation must not forge a new human marker");
  assert.ok(first.writes.every((request) => request.calendarId !== sharedCalendarId || request.eventId !== mirror.id || request.body?.colorId !== "9"));
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("an unavailable legacy cancellation audit never authorizes a repair or an inferred cancellation", async () => {
  const harness = createHarness(new Date("2026-11-06T14:00:00Z"));
  const { source, mirror, publicMember } = seedTonySourceAndMirror(harness);
  harness.setAuditReadError(true);
  const pass = await harness.runSync({ allowErrors: true });
  assert.deepEqual(pass.writes, [], "unknown human intent must not be replaced by a guess");
  assert.equal(harness.get(sharedCalendarId, mirror.id!)?.colorId, "11");
  assertScheduled(harness.get(publicMember.calendarId, source.id!));
});

test("a deleted Google source cannot turn the remaining shared appointment into a business cancellation", async () => {
  const harness = createHarness(new Date("2026-11-06T14:00:00Z"));
  const { source, mirror, publicMember } = seedTonySourceAndMirror(harness);
  harness.externalEdit(sharedCalendarId, mirror.id!, { colorId: "9", extendedProperties: { private: { inrcyAppointmentStatus: "appointment_scheduled_direct" } } });
  harness.seed(publicMember.calendarId, { id: source.id, status: "cancelled" });
  const pass = await harness.runSync();
  assertNoInferredBusinessCancellation(pass.requests);
  const active = harness.events(sharedCalendarId).filter((event) => event.status !== "cancelled");
  assert.equal(active.length, 1);
  assertScheduled(active[0]);
  assert.deepEqual((await harness.runSync()).writes, []);
});

test("confirming an old unmarked cancellation records the first human authority once and repeating it is idempotent", async () => {
  const harness = createHarness();
  const { canonical, replicas } = seedScheduledFamily(harness);
  for (const [calendarId, id] of [[sharedCalendarId, canonical.id!], ...replicas.map(({ member, replica }) => [member.calendarId, replica.id!] as const)]) {
    harness.externalEdit(calendarId, id, { colorId: "11", extendedProperties: { private: { inrcyAppointmentStatus: "appointment_cancelled" } } });
  }
  const action = { mirrorEventId: canonical.id!, status: "appointment_cancelled" as const, actor: { userId: "11111111-1111-4111-8111-111111111111", email: "jimmy@inrcy.com", name: "Staff Human" } };
  await harness.api.updateVisioTeamAppointmentStatus(action);
  for (const [calendarId, id] of [[sharedCalendarId, canonical.id!], ...replicas.map(({ member, replica }) => [member.calendarId, replica.id!] as const)]) {
    const event = harness.get(calendarId, id)!;
    assert.equal(event.extendedProperties?.private?.[lifecycle.VISIO_APPOINTMENT_MANUAL_CANCELLATION_KEY], lifecycle.VISIO_APPOINTMENT_MANUAL_CANCELLATION_VALUE);
    assert.equal(event.extendedProperties?.private?.[lifecycle.VISIO_APPOINTMENT_MANUAL_CANCELLATION_ACTOR_KEY], "11111111-1111-4111-8111-111111111111");
    assert.equal(event.colorId, "11");
  }
  assert.equal(harness.databaseWrites.length, 1);
  const beforeRepeat = harness.requests.length;
  await harness.api.updateVisioTeamAppointmentStatus(action);
  assert.equal(harness.databaseWrites.length, 1, "one explicit confirmation produces one audit record");
  assert.ok(harness.requests.slice(beforeRepeat).every((request) => request.method === "GET"));
  assert.deepEqual((await harness.runSync()).writes, []);
});

for (const mirrorState of ["missing", "scheduled"] as const) {
  test(`an unproven legacy cancelled source creates no new cancelled mirror when its shared mirror is ${mirrorState}`, async () => {
    const harness = createHarness(new Date("2026-11-06T14:00:00Z"));
    const { source, mirror, publicMember } = seedTonySourceAndMirror(harness);
    harness.externalEdit(publicMember.calendarId, source.id!, { colorId: "11", extendedProperties: { private: { inrcyAppointmentStatus: "appointment_cancelled" } } });
    if (mirrorState === "missing") harness.remove(sharedCalendarId, mirror.id!);
    else harness.externalEdit(sharedCalendarId, mirror.id!, { colorId: "9", extendedProperties: { private: { inrcyAppointmentStatus: "appointment_scheduled_direct" } } });
    const pass = await harness.runSync();
    assert.equal(pass.writes.filter((request) => request.method === "POST").length, 0, "a historical cancellation without human authority cannot create new copies");
    assertNoInferredBusinessCancellation(pass.requests);
    assert.equal(harness.get(publicMember.calendarId, source.id!)?.extendedProperties?.private?.inrcyAppointmentStatus, "appointment_cancelled", "unknown history must not be silently reopened");
    if (mirrorState === "scheduled") assertScheduled(harness.get(sharedCalendarId, mirror.id!));
  });
}
