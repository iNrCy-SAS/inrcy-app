import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { hasAccountingDashboardAccess, hasAgentAutomationAccess, hasPremiumDashboardAccess, type DashboardEdition } from "../../lib/dashboardEdition.ts";

type Row = Record<string, unknown>;

function load<T>(path: string, dependencies: Row, extraExport = ""): T {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8") + extraExport;
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  // Dormant dependencies are inert; all I/O used by the exercised paths is explicit below.
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Date, Set, Map, console, URL })(
    (name: string) => dependencies[name] ?? {}, loaded, loaded.exports,
  );
  return loaded.exports as T;
}

function harness(edition: DashboardEdition, lookupFails = false) {
  const calls: string[] = [];
  const dependencies: Row = {
    "@/lib/dashboardEdition": { hasAgentAutomationAccess, hasPremiumDashboardAccess },
    "@/lib/dashboardEditionServer": {
      async getDashboardEditionForAccountId(accountId: string) {
        assert.equal(accountId, "account-active");
        calls.push("edition");
        if (lookupFails) throw new Error("edition_unavailable");
        return edition;
      },
    },
    "@/lib/notificationWriter": { insertNotificationOnce: async () => { throw new Error("unexpected_notification"); } },
    "@/lib/txMailer": { sendTxMail: async () => { throw new Error("unexpected_email"); } },
  };
  const supabase = {
    from(table: string) {
      calls.push(table);
      assert.notEqual(edition, "basic", "Basic must be rejected before reading queued notices or delivery preferences");
      const query: Row = {};
      for (const method of ["select", "eq", "gte", "lte", "order", "limit"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      query.maybeSingle = async () => ({ data: { email_enabled: false }, error: null });
      return query;
    },
  };
  const editorial = load<{ notifyReadyInrAgentEditorialBatch(args: Row): Promise<Row> }>("lib/inrAgentEditorialPlanServer.ts", dependencies);
  const delivery = load<{ deliverInrAgentValidationReadyEmail(args: Row): Promise<Row> }>("lib/inrAgentValidationEmailDelivery.ts", dependencies);
  const args = { supabase, userId: "account-active", horizonDays: 15, deliveryKey: "pending-before-pack-change", actionIds: ["old-publication"], kind: "ready", publicationCount: 1 };
  return { calls, editorial, delivery, args };
}

test("a downgrade to Basic blocks queued publication notices and validation emails", async () => {
  const h = harness("basic");
  assert.equal((await h.editorial.notifyReadyInrAgentEditorialBatch(h.args)).status, "standard_required");
  assert.equal((await h.delivery.deliverInrAgentValidationReadyEmail(h.args)).status, "standard_required");
  assert.deepEqual(h.calls, ["edition", "edition"]);
});

for (const edition of ["standard", "premium", "founder"] as const) {
  test(`${edition} keeps publication notifications available`, async () => {
    const h = harness(edition);
    assert.equal((await h.editorial.notifyReadyInrAgentEditorialBatch(h.args)).status, "not_ready");
    assert.equal((await h.delivery.deliverInrAgentValidationReadyEmail(h.args)).status, "preferences_disabled");
    assert.deepEqual(h.calls, ["edition", "inr_agent_actions", "edition", "notification_preferences"]);
  });
}

test("an unavailable pack lookup cannot send or write a queued validation notice", async () => {
  const h = harness("standard", true);
  await assert.rejects(h.editorial.notifyReadyInrAgentEditorialBatch(h.args), /edition_unavailable/);
  await assert.rejects(h.delivery.deliverInrAgentValidationReadyEmail(h.args), /edition_unavailable/);
  assert.deepEqual(h.calls, ["edition", "edition"]);
});

test("non-Premium statistics emails discard mailbox recommendations and keep included tools", () => {
  const runtime = load<{ sanitizeStatsInsightsForEdition(insights: Row, edition: DashboardEdition): Row }>(
    "app/api/agent/actions/send-stats-report/route.ts",
    { "@/lib/dashboardEdition": { hasAccountingDashboardAccess, hasPremiumDashboardAccess } },
    "\nexport { sanitizeStatsInsightsForEdition };",
  );
  const forbidden = [
    "Connectez Gmail pour relancer vos prospects.",
    "Activez Microsoft ou Outlook.",
    "Ajoutez une boîte e-mail dans votre messagerie.",
    "Configurez IMAP puis préparez un emailing.",
    "Ouvrez iNr’Send pour consulter vos messages reçus.",
    "Utilisez iNrCalendar pour vos rendez-vous.",
    "Créez une campagne avec iNr’ADS.",
    "Lancez une campagne par email.",
    "Fidéliser facilite les relances clients.",
  ];
  const allowed = ["Publiez sur vos canaux connectés avec Booster.", "Consultez iNr’Send Publications.", "Répondez aux demandes reçues depuis iNrBadge."];
  for (const edition of ["basic", "standard"] as const) {
    const result = runtime.sanitizeStatsInsightsForEdition({
      globalSummary: forbidden[0], strengths: allowed, weaknesses: forbidden, recommendations: [...forbidden, ...allowed],
      channelNotes: { gmail: forbidden[0], facebook: allowed[0] },
    }, edition);
    assert.equal(result.globalSummary, undefined);
    assert.deepEqual(Array.from(result.recommendations as string[]), allowed);
    assert.deepEqual(Array.from(result.weaknesses as string[]), []);
    assert.equal((result.channelNotes as Row).gmail, undefined);
    assert.equal((result.channelNotes as Row).facebook, allowed[0]);
  }
  const premiumInsights = { recommendations: forbidden.slice(0, 5) };
  assert.deepEqual(Array.from(runtime.sanitizeStatsInsightsForEdition(premiumInsights, "premium").recommendations as string[]), forbidden.slice(0, 5));
  const founderInsights = { recommendations: forbidden };
  assert.equal(runtime.sanitizeStatsInsightsForEdition(founderInsights, "founder"), founderInsights);
});

test("Premium reports keep quote conversions but cannot recommend Founder accounting tools", () => {
  const runtime = load<{ sanitizeStatsInsightsForEdition(insights: Row, edition: DashboardEdition): Row }>(
    "app/api/agent/actions/send-stats-report/route.ts",
    { "@/lib/dashboardEdition": { hasAccountingDashboardAccess, hasPremiumDashboardAccess } },
    "\nexport { sanitizeStatsInsightsForEdition };",
  );
  const forbidden = ["Ouvrez Encaisser pour gérer votre activité.", "Activez iNr’Compta.", "Utilisez inrcompta pour préparer la facturation.", "Ouvrez le module Devis.", "Utilisez vos factures dans le module."];
  const allowed = ["Les demandes de devis ont progressé.", "Analysez la conversion des demandes de devis reçues.", "Connectez Gmail pour relancer vos prospects.", "Créez une campagne avec iNr’ADS."];
  const result = runtime.sanitizeStatsInsightsForEdition({ recommendations: [...forbidden, ...allowed] }, "premium");
  assert.deepEqual(Array.from(result.recommendations as string[]), allowed);
  const founderInsights = { recommendations: forbidden };
  assert.equal(runtime.sanitizeStatsInsightsForEdition(founderInsights, "founder"), founderInsights);
});
