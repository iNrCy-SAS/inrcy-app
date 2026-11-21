import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as validation from "../../app/dashboard/agent/_lib/agent.publication-validation.ts";
import * as visibility from "../../app/dashboard/agent/_lib/agent.publication-visibility.ts";
import * as carousel from "../../app/dashboard/agent/_lib/agent.publication-carousel.ts";
import * as selection from "../../lib/inrAgentPublicationChannelSelection.ts";
import { runtimeModules } from "./runtime-module-loader.mts";

const source = ts.createSourceFile("AgentClient.tsx", readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const bindings = new Map<string, string>();
const controls = new Map<string, ts.JsxOpeningElement>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node)) bindings.set(node.name.getText(source), `const ${node.getText(source)};`);
  if (ts.isFunctionDeclaration(node) && node.name) bindings.set(node.name.text, node.getText(source));
  if (ts.isJsxOpeningElement(node)) {
    const cls = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === "className");
    if (cls && ts.isJsxAttribute(cls) && cls.initializer && ts.isJsxExpression(cls.initializer)) {
      const name = cls.initializer.expression?.getText(source);
      if (name === "styles.validateButton" || name === "styles.refuseButton" || name === "styles.publishFooterStatus") controls.set(name, node);
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
function binding(name: string) {
  const value = bindings.get(name);
  assert.ok(value, name);
  return value;
}
function attribute(control: string, key: string) {
  const element = controls.get(`styles.${control}`);
  const attr = element?.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === key);
  assert.ok(attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression, `${control}.${key}`);
  return attr.initializer.expression.getText(source);
}

const load = runtimeModules();
const catalog = JSON.parse(readFileSync(new URL("../../messages/fr-FR/agent.json", import.meta.url), "utf8"));
const baseContext = {
  ...validation, ...visibility, ...selection, ...carousel,
  ...load<Record<string, unknown>>("app/dashboard/agent/_lib/agent.settings.ts"),
  ...load<Record<string, unknown>>("app/dashboard/agent/_lib/agent.config.ts"),
  ...load<Record<string, unknown>>("app/dashboard/agent/_lib/agent.campaign-preview.ts"),
  isPublishView: true, selectedKey: "publish", selected: { key: "publish" },
  scheduledEditSession: null, publishPlacementSaveState: "idle", publishChannelSelectionSaving: false,
  selectedChannelByAutomation: {}, tiktokSessionCheckState: "idle", publicationRestoreState: "idle",
  tiktokSessionCheckInFlightRef: { current: false }, selectedAvailableChannels: ["siteWeb", "instagram", "tiktok"],
  selectedConfigChannels: ["siteWeb", "instagram", "tiktok"], loadState: "ready",
  asRecord: (value: unknown) => typeof value === "object" && value !== null ? value : null,
  useMemo: (calculate: () => unknown) => calculate(), i18nT: (key: string) => catalog[key],
  setPublishMediaActiveIndex() {},
};
const names = [
  "isAgentActionAwaitingValidation", "isRobotPlannedPublication", "publicationStatusCounts", "publicationCarouselActions", "isInstantPublicationPreview",
  "selectedPreparedActionFromActions", "selectedPreparedAction", "hasPreparedAction", "canReviewSelectedAction", "publicationViewerActions",
  "preparedChannels", "pendingPublicationChannels", "unvalidatedPublicationChannels", "selectedPublishChannels", "publicationPreviewChannels",
  "canEditPublicationChannels", "selectablePreviewChannels", "displayChannels", "previewNavigationChannels", "placeholderPreviewChannels", "selectedAutomationChannel",
  "activePreviewChannel", "activePublicationReviewState", "automaticTiktokReview", "canConfirmAdditionalChannels", "publishValidationLabel",
  "canNavigatePublications", "movePublication", "movePreviewChannel",
];
const js = ts.transpileModule(`function inspect(ctx) {
  const { ${Object.keys(baseContext).filter(name => !names.includes(name) && name !== "default").join(", ")},
    actions, allPublicationCarouselActions, publicationVisibilityNow, publicationStatusFilters, selectedPreparedActionId, selectedChannelByAction,
    instantPublishPreparationInProgress, setSelectedPreparedActionId, selectPreviewChannel, savePublicationChannelSelection, confirmRobotPlannedPublication } = ctx;
  ${names.map(binding).join("\n")}
  return { id: selectedPreparedAction?.id, ids: publicationViewerActions.map(item => item.id),
    counts: publicationStatusCounts, channels: publicationPreviewChannels, active: activePreviewChannel,
    footer: ${attribute("publishFooterStatus", "data-validation-state")}, label: publishValidationLabel,
    validateDisabled: ${attribute("validateButton", "disabled")}, refuseDisabled: ${attribute("refuseButton", "disabled")},
    validate: ${attribute("validateButton", "onClick")}, movePublication, movePreviewChannel };
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const inspect = new Function(`${js};return inspect;`)();
const clock = Date.parse("2027-01-01T10:00:00Z");
const base = { automationKey: "publish", actionType: "publication", targetTool: "booster",
  scheduledFor: new Date(clock + 3_600_000).toISOString(), targetChannels: ["site_web", "instagram", "tiktok"],
  payload: { editorialPlan: { state: "ready" } }, status: "prepared", executionPolicy: "manual_validation", validationRequired: true };
const actions = [
  { ...base, id: "mixte", status: "scheduled", executionPolicy: "automatic_after_settings", validationRequired: false,
    payload: { ...base.payload, publicationChannelSelection: { version: 1, availableChannels: base.targetChannels, unvalidatedChannels: ["tiktok"] } } },
  { ...base, id: "manuelle", targetChannels: ["instagram"] },
  { ...base, id: "brouillon", status: "draft", payload: { editorialPlan: { state: "queued" } } },
  { ...base, id: "refusee", status: "refused" },
];

test("les filtres du carrousel déterminent le canal visible, le statut et la portée du bouton Valider", () => {
  const all = { validated: true, pending: true, creating: true, refused: true };
  const one = (state: keyof typeof all) => ({ validated: false, pending: false, creating: false, refused: false, [state]: true });
  let selectedId = "mixte";
  const channels: Record<string, string> = { mixte: "siteWeb" };
  const calls: string[] = [];
  const view = (filters = all, instant = false) => inspect({
    ...baseContext, actions, allPublicationCarouselActions: actions, publicationVisibilityNow: clock, publicationStatusFilters: filters,
    selectedPreparedActionId: selectedId, selectedChannelByAction: channels, instantPublishPreparationInProgress: instant,
    setSelectedPreparedActionId: (id: string) => { selectedId = id; },
    selectPreviewChannel: (channel: string) => { channels[selectedId] = channel; },
    savePublicationChannelSelection: () => { calls.push("confirmer les canaux retenus"); },
    confirmRobotPlannedPublication: () => { calls.push("valider la publication manuelle"); },
  });

  let screen = view();
  assert.deepEqual(screen.ids, ["mixte", "manuelle", "brouillon", "refusee"]);
  assert.deepEqual(screen.counts, { validated: 1, pending: 2, creating: 1, refused: 1 });
  assert.equal(screen.active, "siteWeb");
  assert.equal(screen.label, "Validée");
  assert.ok(screen.validateDisabled && screen.refuseDisabled);

  screen = view(one("pending"));
  assert.deepEqual(screen.ids, ["mixte", "manuelle"]);
  assert.deepEqual(screen.channels, ["tiktok"]);
  assert.equal(screen.active, "tiktok");
  assert.equal(screen.footer, "pending");
  assert.equal(screen.label, "À valider");
  assert.equal(screen.validateDisabled, false);
  assert.equal(screen.refuseDisabled, true, "un refus global toucherait les canaux déjà programmés");
  screen.validate();
  screen.movePublication(1);
  screen = view(one("pending"));
  assert.equal(screen.id, "manuelle");
  assert.equal(screen.active, "instagram");
  assert.equal(screen.validateDisabled, false);
  assert.equal(screen.refuseDisabled, false);
  screen.validate();
  assert.deepEqual(calls, ["confirmer les canaux retenus", "valider la publication manuelle"]);

  screen = view(one("validated"));
  assert.deepEqual(screen.ids, ["mixte"]);
  assert.deepEqual(screen.channels, ["siteWeb", "instagram"]);
  assert.equal(screen.active, "siteWeb");
  selectedId = screen.id;
  screen.movePreviewChannel(1);
  screen = view(one("validated"));
  assert.equal(screen.active, "instagram");
  assert.equal(screen.footer, "validated");
  assert.ok(screen.validateDisabled && screen.refuseDisabled);

  for (const [state, id, label] of [["creating", "brouillon", "En création"], ["refused", "refusee", "Refusée"]] as const) {
    screen = view(one(state));
    assert.deepEqual(screen.ids, [id]);
    assert.equal(screen.footer, state);
    assert.equal(screen.label, label);
    assert.ok(screen.validateDisabled && screen.refuseDisabled);
  }
  selectedId = carousel.INSTANT_PUBLICATION_PREPARATION_ID;
  screen = view(one("creating"), true);
  assert.deepEqual(screen.ids, [selectedId, "brouillon"]);
  assert.equal(screen.counts.creating, 2);
  assert.equal(screen.active, null);
  assert.equal(screen.footer, "creating");
  assert.ok(screen.validateDisabled && screen.refuseDisabled);
});
