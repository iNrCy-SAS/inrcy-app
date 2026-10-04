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

type Event = mirrorPolicy.TeamCalendarEvent;
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
};
type HarnessModule = {
  getVisioTeamMembers(): Member[];
  syncVisioTeamCalendarsToShared(input: { now: Date }): Promise<SyncResult>;
  __fixtures: {
    managedCalendarReplicaBody(event: Event, member: Member): Event;
    withTeamCalendarAutomationSnapshot(event: Event): Event;
  };
};

const sharedCalendarId = "shared@example.test";
const now = new Date("2026-10-04T12:00:00.000Z");
const nativeRequire = createRequire(import.meta.url);
const sourcePath = new URL("../../lib/visioBookingGoogle.ts", import.meta.url);

// Only external boundaries are mocked. The synchronizer, reconciliation,
// mutation wrappers, caches, and all policy modules execute their actual code.
const compiled = ts.transpileModule(
  `${readFileSync(sourcePath, "utf8")}\nexport const __fixtures = {
    managedCalendarReplicaBody, withTeamCalendarAutomationSnapshot,
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

function createHarness() {
  const calendars = new Map<string, Map<string, Event>>();
  const hiddenFromListings = new Set<string>();
  const requests: Request[] = [];
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
    requests.push({ method, calendarId, eventId, body });
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
      return event ? jsonResponse(responseEvent(event)) : jsonResponse({ error: { message: "missing" } }, 404);
    }
    if (method === "PATCH") {
      const current = events.get(eventId);
      if (!current) return jsonResponse({ error: { message: "missing" } }, 404);
      const updated = mergePatch(current, body) as Event;
      updated.updated = now.toISOString();
      events.set(eventId, updated);
      return jsonResponse(responseEvent(updated));
    }
    if (method === "POST" && !eventId) {
      const id = String(body?.id || "");
      assert.ok(id, "inserts must retain deterministic ids");
      if (events.has(id)) return jsonResponse({ error: { message: "already exists" } }, 409);
      const created = { ...body, id, organizer: { email: calendarId }, updated: now.toISOString() } as Event;
      events.set(id, created);
      return jsonResponse(responseEvent(created));
    }
    throw new Error(`unexpected Calendar operation: ${method} ${url.pathname}`);
  };
  const database = {
    from(table: string) {
      assert.ok(["integrations", "profiles"].includes(table), `unexpected database table: ${table}`);
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          return {
            error: null,
            data: table === "integrations"
              ? { id: "integration", user_id: "staff", access_token_enc: "test-token", expires_at: "2099-01-01T00:00:00Z" }
              : { first_name: "Test", last_name: "Professional", contact_email: "client@example.test", company_legal_name: "Test Company", phone: "0102030405" },
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
  runInNewContext(compiled, {
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
  }, { filename: "visioBookingGoogle.convergence.cjs" });
  return {
    api: exports,
    members: exports.getVisioTeamMembers(),
    seed(calendarId: string, event: Event, hidden = false) {
      assert.ok(event.id);
      calendar(calendarId).set(event.id, structuredClone(event));
      if (hidden) hiddenFromListings.add(`${calendarId}\n${event.id}`);
    },
    get(calendarId: string, eventId: string) {
      return structuredClone(calendar(calendarId).get(eventId));
    },
    remove(calendarId: string, eventId: string) {
      calendar(calendarId).delete(eventId);
    },
    externalEdit(calendarId: string, eventId: string, patch: Partial<Event>) {
      const current = calendar(calendarId).get(eventId);
      assert.ok(current);
      calendar(calendarId).set(eventId, mergePatch(current, patch) as Event);
    },
    async runSync() {
      const firstRequest = requests.length;
      const result = await exports.syncVisioTeamCalendarsToShared({ now });
      assert.equal(result.locked, false);
      assert.equal(result.ok, true, JSON.stringify(result.errors));
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
