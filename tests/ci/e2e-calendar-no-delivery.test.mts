import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const spec = readFileSync(new URL("../e2e/calendar-events-write.spec.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/calendar/events/route.ts", import.meta.url), "utf8");
const reminders = readFileSync(new URL("../../app/api/cron/calendar-reminders/route.ts", import.meta.url), "utf8");

function actualE2ECreatePayload(): Record<string, unknown> {
  const source = ts.createSourceFile("calendar-events-write.spec.ts", spec, ts.ScriptTarget.Latest, true);
  let expression = "";
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "JSON.stringify") {
      assert.equal(expression, "", "The E2E spec must have a single creation payload");
      expression = node.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  return new Function("startIso", "endIso", `return (${expression});`)(
    "2026-10-01T12:00:00.000Z", "2026-10-01T13:00:00.000Z",
  ) as Record<string, unknown>;
}

function routeHarness() {
  const inserted: Record<string, unknown>[] = [];
  const calls = { notification: 0, settings: 0, smtp: 0, integration: 0 };
  const supabase = {
    from(table: string) {
      assert.equal(table, "agenda_events");
      return {
        insert(payload: Record<string, unknown>) {
          inserted.push(payload);
          return { select: () => ({ single: async () => ({ data: { id: "e2e-draft" }, error: null }) }) };
        },
      };
    },
  };
  const imports: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ supabase, user: { id: "e2e-account" }, activeUserId: "e2e-account", errorResponse: null }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => {
      calls.settings++;
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: { inrcalendar: { send_confirmation_on_save: false } } } }) }) }) };
    } } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "unexpected database error" }, { status: 500 }) },
    "@/lib/env": { optionalEnv: () => "configured" },
    "@/lib/txMailer": { sendTxMail: async () => { calls.smtp++; } },
    "@/lib/inrsend/sendMailFromIntegration": { sendMailFromIntegration: async () => { calls.integration++; } },
    "@/lib/observability/withApi": { withApi: (handler: unknown) => handler },
    "@/lib/observability/logger": { log: {} },
    "@/lib/notificationWriter": { insertNotificationOnce: async () => { calls.notification++; } },
    "@/lib/inrCalendarGoogleSyncConstants": { INR_CALENDAR_GOOGLE_SOURCE: "google_shared_calendar" },
    "@/lib/inrCalendarGoogleSync": {},
    "@/lib/visioTeamAccess": {},
    "@/lib/clientCommunication": {},
  };
  const compiled = ts.transpileModule(route, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return { post: exports.POST as (request: Request) => Promise<Response>, inserted, calls };
}

test("the exact E2E agenda payload creates a scoped draft without consulting delivery settings or calling any notifier", async () => {
  const payload = actualE2ECreatePayload();
  const harness = routeHarness();
  const response = await harness.post(new Request("https://local.test/api/calendar/events", {
    method: "POST", body: JSON.stringify(payload),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "e2e-draft" });
  assert.equal(harness.inserted.length, 1);
  assert.equal(harness.inserted[0].user_id, "e2e-account");
  const meta = harness.inserted[0].meta as Record<string, unknown>;
  assert.equal(meta.status, "draft");
  assert.equal((meta.reminders as Record<string, unknown>).enabled, false);
  assert.deepEqual(harness.calls, { notification: 0, settings: 0, smtp: 0, integration: 0 });
  // A failed test cleanup still cannot leave a future automatic reminder.
  const guard = reminders.indexOf("if (reminders.enabled === false) continue;");
  assert.ok(guard > 0);
  assert.ok(guard < reminders.indexOf("const minutesUntil =", guard));
});

test("the same real route consults notification settings for an ordinary event, proving the draft guard is exercised", async () => {
  const payload = actualE2ECreatePayload();
  delete payload.inrcy;
  const harness = routeHarness();
  const response = await harness.post(new Request("https://local.test/api/calendar/events", {
    method: "POST", body: JSON.stringify(payload),
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.calls.notification, 1);
  assert.equal(harness.calls.settings, 1);
});
