import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { nextAdsPublicationProgress, type AdsPublicationPhase } from "../lib/adsPublicationProgress.ts";

test("la progression d’attente est douce, monotone et plafonnée tant que la plateforme ne répond pas", () => {
  let value = 0;
  for (const phase of ["saving", "sending"] as const) {
    for (let tick = 0; tick < 1000; tick += 1) {
      const next = nextAdsPublicationProgress(value, phase);
      assert.ok(next >= value);
      assert.ok(next - value <= 4);
      assert.ok(next < 100);
      value = next;
    }
    assert.equal(value, phase === "saving" ? 12 : 99);
  }
});

function launchHarness(outcome: "success" | "error" | "unconfirmed") {
  const path = "app/dashboard/ads/AdsClient.tsx";
  const source = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "confirmCampaignLaunch") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const phases: AdsPublicationPhase[] = [];
  const dialogs: ({ mode: string } | null)[] = [];
  const events: string[] = [];
  let notice = "";
  let busy: string | null = null;
  let releasePublish!: () => void;
  let publishStarted!: () => void;
  const started = new Promise<void>((resolve) => { publishStarted = resolve; });
  const waitForResponse = new Promise<void>((resolve) => { releasePublish = resolve; });
  const demoSubmissionRef = { current: false };
  const scope = {
    demoDialog: { mode: "confirm", channelId: "google", launchStatus: "active", details: { accountId: "123" } },
    busy: null, demoSubmissionRef, channelId: "google", creating: true, step: 8, validationStep: 8,
    channelPublishingEnabled: true, channelMeta: { label: "Google Ads" }, draft: {}, savedId: "draft-id",
    ADS_PAUSED_PUBLISH_CONFIRMATION: "paused", ADS_LIVE_PUBLISH_CONFIRMATION: "active",
    parseAdsCampaignInput: () => ({ draft: {} }), readJson: async (value: unknown) => value,
    setPublicationPhase: (phase: AdsPublicationPhase) => { phases.push(phase); events.push(phase); },
    setBusy: (value: string | null) => { busy = value; },
    setNotice: (value: string) => { notice = value; },
    setDraft: () => {}, setSavedId: () => {}, setDirty: () => {}, setConfirmedSpend: () => {},
    setDemoDialog: (value: { mode: string } | null) => { dialogs.push(value); events.push(`dialog:${value?.mode || "closed"}`); },
    fetch: async (url: string) => {
      if (!url.endsWith("/publish")) return { campaign: { id: "draft-id" } };
      publishStarted();
      await waitForResponse;
      if (outcome === "error") throw new Error("Publication refusée");
      return { campaign: { status: outcome === "success" ? "active" : "publishing" } };
    },
  };
  const launch = new Function(...Object.keys(scope), `${compiled}\nreturn confirmCampaignLaunch;`)(...Object.values(scope)) as () => Promise<void>;
  return { launch, started, release: () => releasePublish(), phases, dialogs, events, state: () => ({ busy, notice, inFlight: demoSubmissionRef.current }) };
}

test("100% n’est autorisé qu’après réponse confirmée et état local de succès", async () => {
  const run = launchHarness("success");
  const pending = run.launch();
  await run.started;
  assert.deepEqual(run.phases, ["saving", "sending"]);
  assert.deepEqual(run.dialogs, []);
  assert.equal(run.state().busy, "demo");
  run.release();
  await pending;
  assert.deepEqual(run.phases, ["saving", "sending", "success"]);
  assert.ok(run.events.indexOf("dialog:success") < run.events.indexOf("success"));
  assert.deepEqual(run.state(), { busy: null, notice: "", inFlight: false });
});

test("une erreur ou un statut non confirmé réinitialise l’attente sans afficher100%", async () => {
  for (const outcome of ["error", "unconfirmed"] as const) {
    const run = launchHarness(outcome);
    const pending = run.launch();
    await run.started;
    run.release();
    await pending;
    assert.deepEqual(run.phases, ["saving", "sending", "idle"]);
    assert.deepEqual(run.dialogs, [null]);
    assert.equal(run.state().busy, null);
    assert.equal(run.state().inFlight, false);
    assert.ok(run.state().notice);
  }
});
