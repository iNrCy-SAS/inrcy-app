import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const modules = new Map();

// Execute the shared builder and its real pure helpers, resolving app aliases
// without importing Next.js or making requests to the application.
function loadTypeScript(file) {
  file = resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const compiledModule = { exports: {} };
  modules.set(file, compiledModule);
  const javascript = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const localRequire = (id) => {
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/")
      ? resolve(ROOT, id.slice(2))
      : resolve(dirname(file), id);
    const target = [base, `${base}.ts`, `${base}.tsx`].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );
    assert.ok(target, `Cannot resolve ${id} from ${file}`);
    return loadTypeScript(target);
  };
  runInThisContext(
    `(function(exports, require, module) { ${javascript}\n})`,
    { filename: file },
  )(compiledModule.exports, localRequire, compiledModule);
  return compiledModule.exports;
}

const { buildAgentScheduleItems } = loadTypeScript(
  resolve(ROOT, "app/dashboard/agent/_lib/agent.schedule-items.ts"),
);
const { automations, defaultConfigs } = loadTypeScript(
  resolve(ROOT, "app/dashboard/agent/_lib/agent.config.ts"),
);
const catalog = JSON.parse(readFileSync(resolve(ROOT, "messages/fr-FR/agent.json"), "utf8"));
const SCHEDULED_AT = "2030-10-19T16:00:00.000Z";
const CONTENT_TITLE = "Un sujet commun à plusieurs publications";

function editorial(id = "source-one", overrides = {}) {
  return {
    id, automationKey: "publish", actionType: "publication", targetTool: "booster",
    title: "Publication Coulisses prête", summary: "Texte initial", previewText: "Texte initial",
    targetChannels: ["siteWeb", "facebook"], targetThemes: ["Coulisses"], recipients: [], imageAssets: [],
    status: "scheduled", executionPolicy: "manual_validation", validationRequired: true,
    validatedAt: "2030-10-01T08:00:00Z", scheduledFor: SCHEDULED_AT,
    createdAt: "2030-10-01T08:00:00Z", preparedAt: "2030-10-01T08:00:00Z",
    payload: {
      editorialPlan: { state: "ready", scheduledFor: SCHEDULED_AT },
      scheduledExecution: { scheduledActionIds: ["execution-one"] },
      postByChannel: { site_web: { title: CONTENT_TITLE, content: "Texte initial" } },
    },
    ...overrides,
  };
}

function scheduled(id = "execution-one", sourceActionId = "source-one", overrides = {}) {
  return {
    id, automationKey: "publish", actionType: "publication", targetTool: "booster", source: "manual",
    title: "Publication Coulisses prête · multicanal", summary: "Texte programmé", status: "scheduled",
    channels: ["site_web", "facebook"], scheduledAt: SCHEDULED_AT,
    createdAt: "2030-10-01T08:00:00Z", timezone: "Europe/Paris",
    payload: {
      ...(sourceActionId ? { sourceActionId } : {}),
      publishPayload: {
        channels: ["site_web", "facebook"],
        postByChannel: {
          site_web: { title: CONTENT_TITLE, content: "Texte programmé" },
          facebook: { title: CONTENT_TITLE, content: "Texte programmé" },
        },
      },
    },
    ...overrides,
  };
}

function build(actions, scheduledActions, extras = {}) {
  return buildAgentScheduleItems({
    actions, scheduledActions, historyPublications: [], visibleAutomations: [], configs: defaultConfigs,
    connectedChannels: { siteWeb: true, facebook: true }, locale: "fr-FR",
    translate: (key) => catalog[key] || key,
    ...extras,
  });
}

test("une publication validée ne devient qu'une ligne de son exécution programmée", () => {
  const source = editorial();
  source.payload.scheduledExecution.scheduledActionIds = [];
  const execution = scheduled();
  const before = structuredClone({ source, execution });
  const rows = build([source], [execution], {
    visibleAutomations: automations.filter((item) => item.key === "publish"),
    configs: { ...defaultConfigs, publish: { ...defaultConfigs.publish, enabled: true, channels: ["siteWeb", "facebook"] } },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "manual");
  assert.equal(rows[0].scheduledActionId, execution.id);
  assert.equal(rows[0].preparedActionId, source.id);
  assert.equal(rows[0].themeLabel, "Coulisses");
  assert.equal(rows[0].approvalState, "approved");
  assert.equal(rows[0].contentTitle, CONTENT_TITLE);
  assert.deepEqual({ source, execution }, before, "The projection must not mutate source data");
});

test("le lien inverse conserve la publication source lorsque sourceActionId manque", () => {
  const rows = build([editorial()], [scheduled("execution-one", null)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].preparedActionId, "source-one");
  assert.equal(rows[0].themeLabel, "Coulisses");
  assert.equal(rows[0].approvalState, "approved");
});

test("les programmations par canal gardent leur date, leur état et leur contenu réels", () => {
  const source = editorial();
  source.payload.scheduledExecution.scheduledActionIds.push("execution-two");
  const rows = build([source], [
    scheduled("execution-one", null, {
      channels: ["facebook"], status: "running", scheduledAt: "2030-10-20T16:00:00.000Z",
      payload: { publishPayload: { channels: ["facebook"], postByChannel: { facebook: { title: "Version Facebook", content: "Facebook" } } } },
    }),
    scheduled("execution-two", "source-one", {
      channels: ["site_web"], status: "failed", scheduledAt: "2030-10-21T16:00:00.000Z",
      payload: { sourceActionId: source.id, publishPayload: { channels: ["site_web"], postByChannel: { site_web: { title: "Version du site", content: "Site" } } } },
    }),
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.source === "manual" && row.themeLabel === "Coulisses"));
  const facebook = rows.find((row) => row.scheduledActionId === "execution-one");
  assert.equal(facebook.scheduledAtIso, "2030-10-20T16:00:00.000Z");
  assert.equal(facebook.statusKey, "running");
  assert.equal(facebook.contentTitle, "Version Facebook");
  assert.deepEqual(facebook.channelLabels, ["Facebook"]);
  assert.equal(facebook.editable, false);
  const site = rows.find((row) => row.scheduledActionId === "execution-two");
  assert.equal(site.statusKey, "failed");
  assert.equal(site.contentTitle, "Version du site");
  assert.equal(site.channelLabels.length, 1);
});

test("une programmation absente ou annulée ne masque pas la publication éditoriale", () => {
  for (const executions of [[], [scheduled("execution-one", "source-one", { status: "cancelled" })]]) {
    const rows = build([editorial()], executions);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "editorial");
  }
  const pending = editorial("pending", { status: "pending_validation", validatedAt: null });
  assert.equal(build([pending], [scheduled("other", null)])[0].approvalState, "pending");
});

test("une programmation indépendante garde son contenu sans récupérer un sujet identique", () => {
  const rows = build([editorial()], [scheduled("independent", null)]);
  assert.equal(rows.length, 2);
  const manual = rows.find((row) => row.source === "manual");
  assert.equal(manual.preparedActionId, undefined);
  assert.equal(manual.themeLabel, undefined);
  assert.equal(manual.contentTitle, CONTENT_TITLE);
});

test("des publications distinctes de même titre et au même créneau restent distinctes", () => {
  const first = editorial();
  const second = editorial("source-two");
  second.payload.scheduledExecution.scheduledActionIds = ["execution-two"];
  const rows = build([first, second], [scheduled(), scheduled("execution-two", "source-two")]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.preparedActionId).sort(), ["source-one", "source-two"]);
  assert.ok(rows.every((row) => row.contentTitle === CONTENT_TITLE));
});

test("les métadonnées de validation viennent de la source, le statut de l'exécution", () => {
  const source = editorial("source-one", { status: "refused", refusedAt: "2030-10-01T09:00:00Z" });
  const rows = build([source], [scheduled("execution-one", "source-one", { status: "failed" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].statusKey, "failed");
  assert.equal(rows[0].approvalState, "refused");
});

test("reprogrammer une exécution liée ne recrée pas le créneau automatique de sa source", () => {
  const source = editorial("source-one", { scheduledFor: "2020-10-19T16:00:00.000Z" });
  const enabledPublish = {
    visibleAutomations: automations.filter((item) => item.key === "publish"),
    configs: { ...defaultConfigs, publish: { ...defaultConfigs.publish, enabled: true, channels: ["siteWeb", "facebook"] } },
  };
  const linkedRows = build([source], [scheduled()], enabledPublish);
  assert.equal(linkedRows.length, 1);
  assert.equal(linkedRows[0].source, "manual");
  assert.equal(linkedRows[0].scheduledAtIso, SCHEDULED_AT);

  const independentRows = build([source], [scheduled("independent", null)], enabledPublish);
  assert.ok(independentRows.some((row) => row.source === "automatic"),
    "An independent manual post must not suppress the automatic plan");
  assert.ok(independentRows.some((row) => row.scheduledActionId === "independent"));
});

test("l'historique remplace encore les deux représentations d'une publication terminée", () => {
  for (const status of ["completed", "cancelled"]) {
    const history = {
      id: `history-${status}`, source: "scheduled", status, occurredAt: SCHEDULED_AT,
      title: "Publication terminée", contentTitle: CONTENT_TITLE, channels: ["site_web", "facebook"],
      themes: ["Coulisses"], mediaKind: null, agentActionId: "source-one",
      scheduledActionId: "execution-one", publicationId: null,
    };
    const rows = build([editorial()], [scheduled()], { historyPublications: [history] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "history");
    assert.equal(rows[0].id, history.id);
    assert.equal(rows[0].statusKey, status);
  }
});
