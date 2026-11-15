import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardEditionFromPlan } from "../../lib/dashboardEdition.ts";
import { listMissingNotificationChannels, projectNotificationForEdition } from "../../lib/notificationEditionPolicy.ts";

const social = ["gmb", "facebook", "instagram"].map(product => ({ product, provider: product, category: "social", status: "connected" }));
const notice = <T extends object = Record<string, never>>(kind: string, overrides = {} as T) => ({ kind, title: "Titre", body: "Événement métier", cta_url: "/dashboard", cta_label: "Ouvrir", ...overrides });

for (const plan of ["Basic", "Trial", "Standard", "Premium", "Founder"]) {
  const edition = resolveDashboardEditionFromPlan(plan), premium = edition === "premium" || edition === "founder";
  test(`${plan}: mailbox recommendations follow the commercial edition`, () => {
    assert.equal(listMissingNotificationChannels(social, edition).length, premium ? 1 : 0);
    const missing = listMissingNotificationChannels([], edition);
    assert.equal(missing.length, premium ? 4 : 3);
    assert.equal(/Gmail|Microsoft|IMAP/.test(missing.join(" ")), premium);
    for (const provider of ["gmail", "microsoft", "imap"]) {
      assert.deepEqual(listMissingNotificationChannels([...social, { product: provider, provider, category: "mail", status: "connected" }], edition), []);
    }
    const legacy = notice("connect_channels", { meta: { missing_channels: ["Gmail", "Microsoft"] } });
    const projected = projectNotificationForEdition(legacy, edition);
    assert.equal(Boolean(projected), premium);
    if (projected) assert.equal(projected.title, "1 canal encore activable");
    for (const kind of ["crm_refresh", "cross_sell_mail", "agenda_rappel"]) assert.equal(Boolean(projectNotificationForEdition(notice(kind), edition)), premium, kind);
    for (const kind of ["inr_agent_editorial_batch_ready", "inr_agent_editorial_validation_reminder"]) assert.equal(Boolean(projectNotificationForEdition(notice(kind), edition)), edition !== "basic", kind);
  });
}

test("historical mixed channel recommendations are rebuilt before count and text are exposed", () => {
  const legacy = notice("connect_channels", { meta: { missing_channels: ["Facebook", "Gmail", "Microsoft"] } });
  const result = projectNotificationForEdition(legacy, "standard")!;
  assert.equal(result.title, "1 canal encore activable");
  assert.match(result.body, /Facebook/);
  assert.doesNotMatch(JSON.stringify(result), /Gmail|Microsoft/);
  assert.deepEqual(legacy.meta.missing_channels, ["Facebook", "Gmail", "Microsoft"], "projection never mutates the stored source");
  assert.equal(projectNotificationForEdition(notice("connect_channels"), "premium"), null, "unstructured legacy recommendations fail closed");
});

test("downgrades preserve business events and neutralize unavailable actions without retaining upsells", () => {
  for (const kind of ["inrbadge_lead", "inrsearch_lead", "inrbadge_appointment_request", "agenda_event_saved"]) {
    const event = notice(kind, { cta_url: "/dashboard/crm" });
    const result = projectNotificationForEdition(event, "standard")!;
    assert.equal(result.body, event.body);
    assert.equal(result.cta_url, "/dashboard");
  }
  const campaign = notice("inragent_scheduled_action_failed", { cta_url: "/dashboard/agent", meta: { targetTool: "mails", actionType: "campaign" } });
  assert.equal(projectNotificationForEdition(campaign, "standard")?.cta_url, "/dashboard");
  assert.equal(projectNotificationForEdition(campaign, "premium")?.cta_url, "/dashboard/agent");
  assert.equal(projectNotificationForEdition(notice("onboarding_connect_facebook", { cta_url: "/dashboard/crm" }), "standard"), null);
  const accounting = notice("accounting_recommendation", { cta_url: "/dashboard/factures" });
  assert.equal(projectNotificationForEdition(accounting, "premium"), null);
  assert.equal(projectNotificationForEdition(accounting, "founder")?.cta_url, "/dashboard/factures");
});
