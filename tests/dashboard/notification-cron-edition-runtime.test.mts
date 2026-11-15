import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { resolveDashboardEditionFromPlan, type DashboardEdition } from "../../lib/dashboardEdition.ts";
import * as editions from "../../lib/dashboardEdition.ts";
import * as policy from "../../lib/notificationEditionPolicy.ts";

type Row = Record<string, unknown>;
const now = "2026-11-15T10:00:00.000Z";
function load<T = Row>(path: string, imports: Row): T {
  const output = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => { if (!(name in imports)) throw Error(`Unexpected import ${name}`); return imports[name]; }, loaded, loaded.exports);
  return loaded.exports as T;
}

function fixture(plan: string, options: { mail?: string; deliveryEdition?: DashboardEdition; rightsError?: boolean; integrationsError?: boolean; action?: boolean; information?: boolean; preferencesOff?: boolean } = {}) {
  const edition = resolveDashboardEditionFromPlan(plan), inserted: Row[] = [], mails: Row[] = [], reads: string[] = [];
  const rows: Record<string, Row[]> = {
    notification_preferences: [{ user_id: "account", in_app_enabled: !options.preferencesOff, email_enabled: !options.preferencesOff, performance_enabled: false, action_enabled: options.action !== false, information_enabled: options.information === true, digest_every_hours: 48 }],
    profiles: [{ user_id: "account", last_active_at: now, contact_email: "professional@example.invalid", first_name: "Pro" }],
    integrations: ["gmb", "facebook", "instagram"].map(product => ({ user_id: "account", product, provider: product, category: "social", status: "connected" })),
    daily_metrics_summary: [{ user_id: "account", snapshot_date: now, connected_tools_count: 3, demandes_captees_total: 1, opportunites_activables_total: 2, details: {} }],
    notifications: [], crm_contacts: [{ user_id: "account", id: "contact", created_at: new Date().toISOString() }],
  };
  if (options.mail) rows.integrations.push({ user_id: "account", product: options.mail, provider: options.mail, category: "mail", status: "connected" });
  const supabase = { from(table: string) {
    reads.push(table); let values = rows[table]; if (!values) throw Error(`Unexpected table ${table}`);
    let cap = Infinity;
    const result = () => ({ data: values.slice(0, cap), error: table === "integrations" && options.integrationsError ? { message: "read failed" } : null });
    const query: Row = {
      select: () => query, eq: (key: string, value: unknown) => { values = values.filter(row => row[key] === value); return query; },
      gte: () => query, order: () => query, limit: (value: number) => { cap = value; return query; },
      maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
      then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(result()).then(resolve, reject),
    }; return query;
  } };
  const writer = { insertNotificationOnce: async (row: Row) => { const data = { ...structuredClone(row), id: `notice-${inserted.length}`, created_at: now }; inserted.push(data); return { inserted: true, data }; } };
  const assets = { INRCY_EMAIL_LOGO_CID: "logo", getInrcyLogoInlineAttachments: async () => [] };
  const notifications = load("lib/notifications.ts", { "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin: supabase }, "@/lib/notificationWriter": writer });
  const digest = load("lib/notificationDigestEmail.ts", { "server-only": {}, "@/lib/txEmailAssets": assets });
  const route = load<{ GET: (request: Request) => Promise<Response> }>("app/api/cron/notifications/route.ts", {
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForAccount: async () => false }, "next/server": { NextResponse: { json: Response.json } },
    "@/lib/supabaseAdmin": { supabaseAdmin: supabase }, "@/lib/txMailer": { sendTxMail: async (mail: Row) => { mails.push(mail); } },
    "@/lib/notificationDigestEmail": digest, "@/lib/env": { optionalEnv: (_name: string, fallback?: string) => fallback ?? "fixture-configured" },
    "@/lib/txEmailAssets": assets, "@/lib/notifications": notifications, "@/lib/dashboardEdition": editions,
    "@/lib/dashboardEditionServer": { getDashboardEditionsForAccountIds: async () => { if (options.rightsError) throw Error("rights unavailable"); return new Map([["account", edition]]); }, getDashboardEditionForAccountId: async () => options.deliveryEdition ?? (options.rightsError ? "basic" : edition) },
    "@/lib/notificationEditionPolicy": policy, "@/lib/notificationWriter": writer,
  });
  return { inserted, mails, reads, async run() {
    const previous = process.env.CRON_SECRET; process.env.CRON_SECRET = "notification-fixture";
    const previousVercel = process.env.VERCEL_CRON_SECRET; delete process.env.VERCEL_CRON_SECRET;
    try { return await (await route.GET(new Request("https://app.invalid/api/cron/notifications", { headers: { authorization: "Bearer notification-fixture" } }))).json(); }
    finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; if (previousVercel !== undefined) process.env.VERCEL_CRON_SECRET = previousVercel; }
  } };
}

for (const plan of ["Basic", "Trial", "Standard", "Premium", "Founder"]) test(`${plan}: real cron and real digest never recommend an unavailable mailbox`, async () => {
  const h = fixture(plan, { information: true }); const response = await h.run();
  assert.equal(response.ok, true); assert.deepEqual(response.errors, []);
  const premium = ["Premium", "Founder"].includes(plan);
  assert.equal(h.inserted.some(row => row.kind === "connect_channels"), premium);
  assert.equal(/Gmail|Microsoft|IMAP|iNr'Send/.test(JSON.stringify(h.mails)), premium);
  assert.equal(h.reads.includes("crm_contacts"), premium);
  if (!premium) assert.doesNotMatch(JSON.stringify(h.inserted), /Gmail|Microsoft|IMAP|dashboard\/crm|panel=mails/);
});

test("one connected mailbox satisfies the Premium channel without requesting another provider", async () => {
  for (const mail of ["gmail", "microsoft", "imap"]) {
    const h = fixture("Premium", { mail }); await h.run();
    assert.equal(h.inserted[0].kind, "launch_booster");
    assert.doesNotMatch(JSON.stringify(h.mails), /Gmail|Microsoft|IMAP/);
  }
});

test("a downgrade before delivery suppresses the newly obsolete mail recommendation", async () => {
  const h = fixture("Premium", { deliveryEdition: "standard" }); await h.run();
  assert.equal(h.inserted[0].kind, "connect_channels"); assert.equal(h.mails.length, 0);
});

test("unknown rights fail closed and disabled preferences or unavailable integrations produce no misleading mail", async () => {
  const unknown = fixture("Premium", { rightsError: true, information: true }); await unknown.run();
  assert.doesNotMatch(JSON.stringify(unknown.mails), /Gmail|Microsoft|IMAP|CRM/);
  const disabled = fixture("Premium", { preferencesOff: true }); await disabled.run();
  assert.equal(disabled.inserted.length, 0); assert.equal(disabled.mails.length, 0);
  const failed = fixture("Premium", { integrationsError: true }); const result = await failed.run();
  assert.equal(result.errors.length, 1); assert.equal(failed.inserted.length, 0); assert.equal(failed.mails.length, 0);
});
