import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as mediaModels from "../../lib/aiMediaModelCatalog.ts";
import * as videoTimeline from "../../lib/aiMediaVideoTimeline.ts";
import * as videoOptions from "../../lib/aiMediaVideoClientOptions.ts";

const componentPath = "app/dashboard/_components/MediaGenerationCreationWorkspace.tsx";
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

type Element = { type: unknown; props: Record<string, unknown> };
type Props = Record<string, unknown>;

function element(type: unknown, props: Record<string, unknown> | null): Element {
  return typeof type === "function" ? type(props || {}) : { type, props: props || {} };
}

function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const node = tree as Element;
  return [node, ...elements(node.props.children)];
}

function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" && "props" in tree
    ? text((tree as Element).props.children) : "";
}

function find(tree: unknown, predicate: (node: Element) => boolean) {
  const node = elements(tree).find(predicate);
  assert.ok(node, "Expected rendered element is absent");
  return node;
}

function byClass(tree: unknown, name: string) {
  return find(tree, (node) => node.props.className === name);
}

function button(tree: unknown, label: string) {
  return find(tree, (node) => node.type === "button" && text(node).includes(label));
}

function click(node: Element) {
  assert.equal(node.type, "button");
  assert.notEqual(node.props.disabled, true);
  const action = node.props.onClick;
  assert.equal(typeof action, "function");
  (action as () => void)();
}

let instanceCount = 0;
const modules = new Map<string, unknown>([
  ["react/jsx-runtime", { jsx: element, jsxs: element, Fragment: "fragment" }],
  ["react", { useId: () => `creation-test-${++instanceCount}` }],
  ["next/image", { __esModule: true, default: (props: Props) => element("img", props) }],
  ["next-intl", { useTranslations: () => (key: string) => key }],
  ["@/lib/aiMediaGenerationContracts", contracts],
  ["@/lib/aiMediaModelCatalog", mediaModels],
  ["@/lib/aiMediaVideoTimeline", videoTimeline],
  ["@/lib/aiMediaVideoClientOptions", videoOptions],
  ["./MediaGenerator.module.css", { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) }],
  ["./MediaGenerationCreationWorkspace.module.css", { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) }],
  ["./MediaEngineCreditControls.module.css", { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) }],
]);
// The real shared action wrapper is a presentation dependency, not a request
// owner. Execute it too so the existing lifecycle tests retain their meaning.
const controlsOutput=ts.transpileModule(read("app/dashboard/_components/MediaEngineCreditControls.tsx"),{
  fileName:"MediaEngineCreditControls.tsx",
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const controlsRecord={exports:{} as Record<string,unknown>};
new Function("module","exports","require",controlsOutput)(controlsRecord,controlsRecord.exports,(specifier:string)=>{
  assert.ok(modules.has(specifier),`Unexpected controls dependency: ${specifier}`);return modules.get(specifier);
});
modules.set("./MediaEngineCreditControls",controlsRecord.exports);
const source = read(componentPath);
const output = ts.transpileModule(source, {
  fileName: componentPath,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const record = { exports: {} as { default: (props: Props) => Element; MediaGenerationSettingsTabs: (props: Props) => Element } };
const focusedElements: string[] = [];
new Function("module", "exports", "require", "document", output)(record, record.exports, (specifier: string) => {
  assert.ok(modules.has(specifier), `Unexpected presentation dependency: ${specifier}`);
  return modules.get(specifier);
}, { getElementById: (id: string) => ({ focus: () => focusedElements.push(id) }) });

function render(overrides: Props = {}) {
  return record.exports.default({
    kind: "image", format: "square", durationSeconds: 8, creationMode: "guided", origin: "menu",
    progress: 0, operationLocked: false, finishing: false, generationResult: null,
    generationCancellable: false, cancelConfirmationOpen: false,
    setCancelConfirmationOpen() {}, handleRequestGenerationStop() {}, handleConfirmGenerationStop() {},
    handleConfirm() {}, handleGenerate() {}, handleEditCriteria() {}, disabled: false, acceptMode: "library",
    ...overrides,
  });
}

function mediaResult(kind: "image" | "video", width = 1080, height = 1920) {
  return {
    draft: true, format: "square", videoEngineResult: kind === "video" ? "omni" : null,
    item: { id: "draft-test", media_type: kind, signed_url: "https://example.invalid/preview", width, height, title: "Création test" },
  };
}

test("Libre et Guidé utilisent une seule présentation sans y déplacer leurs requêtes", () => {
  for (const name of ["MediaGenerator", "MediaFreeGenerator"]) {
    const parent = read(`app/dashboard/_components/${name}.tsx`);
    assert.ok(/import MediaGenerationCreationWorkspace(?:,\s*\{[^}]*\})? from "\.\/MediaGenerationCreationWorkspace"/u.test(parent), `${name} imports the shared presentation`);
    assert.match(parent, /<MediaGenerationCreationWorkspace/);
    assert.doesNotMatch(parent, /className=\{styles\.(?:progressPanel|reviewWorkspace|creationProgress|resultPanel)\}/);
  }
  // Type-only result imports are fine; the executable presentation must never own requests.
  assert.doesNotMatch(output, /useMediaGeneration|fetch\(|acceptDraft\(|discardDraft\(|cancelGeneration\(/);
});

test("la progression partagée affiche le vrai pourcentage et conserve la même structure dans les deux modes", () => {
  for (const kind of ["image", "video"] as const) {
    for (const progress of [0, 18, 42, 72, 99]) {
      const trees = ["free", "guided"].map((creationMode) => render({ creationMode, kind, progress, operationLocked: true }));
      assert.deepEqual(
        elements(trees[0]).map((node) => [node.type, node.props.className]),
        elements(trees[1]).map((node) => [node.type, node.props.className]),
      );
      for (const tree of trees) {
        assert.equal(tree.props["data-media-creation-stage"], "progress");
        assert.equal(byClass(tree, "creationProgress").props.role, "status");
        assert.equal(byClass(tree, "creationProgress").props["aria-live"], "polite");
        assert.equal(text(find(tree, (node) => node.type === "strong")), `${progress} %`);
        const fill = find(byClass(tree, "largeProgressTrack"), (node) => node.type === "span");
        assert.equal((fill.props.style as Props).width, `${Math.max(4, progress)}%`);
        if (progress === 99) assert.match(text(tree), /ai_generator_stage_patience/);
        assert.equal(elements(tree).some((node) => node.type === "video" || node.type === "img"), false);
      }
    }
  }
});

test("le même arrêt exige une confirmation et l'avertissement de coût, avec identifiants propres à chaque instance", () => {
  const actions: string[] = [];
  const props = {
    operationLocked: true, generationCancellable: true,
    handleRequestGenerationStop: () => { actions.push("request"); },
    setCancelConfirmationOpen: (open: boolean) => { actions.push(`confirm:${open}`); },
    handleConfirmGenerationStop: () => { actions.push("stop"); },
  };
  click(button(render(props), "ai_generator_stop_generation"));
  assert.deepEqual(actions, ["request"]);
  const free = render({ ...props, creationMode: "free", cancelConfirmationOpen: true });
  const guided = render({ ...props, creationMode: "guided", cancelConfirmationOpen: true });
  const freeDialog = byClass(free, "cancelGenerationDialog");
  assert.equal(freeDialog.props.role, "alertdialog");
  assert.equal(freeDialog.props["aria-modal"], "true");
  assert.notEqual(freeDialog.props["aria-labelledby"], byClass(guided, "cancelGenerationDialog").props["aria-labelledby"]);
  assert.ok(elements(freeDialog).some((node) => node.props.id === freeDialog.props["aria-labelledby"]));
  assert.ok(elements(freeDialog).some((node) => node.props.id === freeDialog.props["aria-describedby"]));
  assert.match(text(freeDialog), /ai_generator_stop_confirm_cost_warning/);
  click(button(free, "ai_generator_stop_confirm_continue"));
  assert.deepEqual(actions, ["request", "confirm:false"]);
  click(button(guided, "ai_generator_stop_confirm_action"));
  assert.deepEqual(actions, ["request", "confirm:false", "stop"]);
  const finalizing = render({ ...props, generationCancellable: false, cancelConfirmationOpen: true });
  assert.equal(elements(finalizing).some((node) => node.props.role === "alertdialog" || node.type === "button"), false);
});

test("chaque résultat affiche son média entier dans son vrai format, avec ses actions hors de la zone aperçu", () => {
  for (const creationMode of ["free", "guided"]) {
    for (const kind of ["image", "video"] as const) {
      for (const dimensions of [[1080, 1080, "square"], [1080, 1350, "portrait"], [1080, 1920, "story"], [1920, 1080, "landscape"]] as const) {
        const result = mediaResult(kind, dimensions[0], dimensions[1]);
        const tree = render({ creationMode, kind, generationResult: result });
        assert.equal(tree.props["data-media-creation-stage"], "result");
        const viewport = byClass(tree, "previewViewport");
        assert.equal(byClass(viewport, "previewFrame").props["data-format"], dimensions[2]);
        const media = find(viewport, (node) => node.type === (kind === "video" ? "video" : "img"));
        assert.equal(media.props.src, result.item.signed_url);
        assert.equal((media.props.style as Props).objectFit, "contain");
        if (kind === "video") {
          assert.equal(media.props.controls, true);
          assert.equal(media.props.playsInline, true);
          assert.equal(media.props.preload, "metadata");
        } else {
          assert.equal(media.props.alt, "Création test");
        }
        assert.equal(elements(viewport).some((node) => node.type === "button"), false);
        assert.equal(elements(byClass(tree, "resultActions")).filter((node) => node.type === "button").length, 3);
      }
    }
  }
});

test("les trois actions de résultat conservent leurs callbacks, le retour insertion et les protections pendant validation", () => {
  for (const acceptMode of ["insert", "library"]) {
    const actions: string[] = [];
    const props = {
      generationResult: mediaResult("image"), acceptMode,
      handleConfirm: () => { actions.push("accept"); },
      handleGenerate: () => { actions.push("regenerate"); },
      handleEditCriteria: () => { actions.push("edit"); },
      editLabel: "Modifier mon prompt",
    };
    const tree = render(props);
    click(button(tree, acceptMode === "insert" ? "ai_generator_confirm_insert" : "ai_generator_open_library"));
    click(button(tree, "ai_generator_regenerate"));
    click(button(tree, "Modifier mon prompt"));
    assert.deepEqual(actions, ["accept", "regenerate", "edit"]);
    const locked = render({ ...props, operationLocked: true, finishing: true, disabled: true });
    for (const node of elements(byClass(locked, "resultActions")).filter((node) => node.type === "button")) {
      assert.equal(node.props.disabled, true);
    }
    assert.match(text(locked), new RegExp(acceptMode === "insert" ? "ai_generator_inserting" : "ai_generator_finishing_library"));
    assert.equal(elements(locked).some((node) => node.props.className === "creationProgress"), false);
  }
});

test("un résultat destiné à être inséré peut aussi être conservé sans quitter la création", () => {
  const actions: string[] = [];
  const draft = mediaResult("image");
  const tree = render({
    generationResult: draft,
    acceptMode: "insert",
    handleConfirm() { actions.push("insert"); },
    handleSaveToLibrary() { actions.push("save"); },
  });

  assert.equal(
    elements(byClass(tree, "resultActions")).filter((node) => node.type === "button").length,
    4,
  );
  click(button(tree, "ai_generator_open_library"));
  assert.deepEqual(actions, ["save"]);

  const saved = render({
    generationResult: { ...draft, draft: false },
    acceptMode: "insert",
    handleSaveToLibrary() { actions.push("save-again"); },
  });
  assert.match(text(byClass(saved, "savedStatus")), /ai_generator_saved_to_library/);
  assert.equal(button(saved, "ai_generator_saved_to_library").props.disabled, true);
});

test("un échec ou un aperçu indisponible garde les commandes de récupération sans prétendre afficher un média", () => {
  const actions: string[] = [];
  const failed = render({ error: "Erreur fournisseur", handleGenerate: () => actions.push("retry"), handleEditCriteria: () => actions.push("edit") });
  assert.equal(failed.props["data-media-creation-stage"], "error");
  assert.match(text(failed), /Erreur fournisseur/);
  click(button(failed, "ai_generator_retry"));
  click(button(failed, "ai_generator_edit_criteria"));
  assert.deepEqual(actions, ["retry", "edit"]);
  const result = mediaResult("image");
  result.item.signed_url = "";
  const unavailable = render({ generationResult: result, actionError: "Validation impossible" });
  assert.match(text(unavailable), /apercu_indisponible_d0ce704a/);
  assert.equal(elements(unavailable).some((node) => node.type === "img" || node.type === "video"), false);
  assert.equal(text(find(unavailable, (node) => node.props.role === "alert")), "Validation impossible");
  assert.equal(elements(byClass(unavailable, "resultActions")).filter((node) => node.type === "button").length, 3);
});

test("les autorisations fraîches restent accessibles pour régénérer ou réessayer, sans bloquer l'acceptation", () => {
  for (const failed of [false, true]) {
    for (const count of [1, 2]) {
      const changes: Array<[string, boolean]> = [];
      const consents = ["identity", "team"].slice(0, count).map((id) => ({
        id, label: `Autorisation ${id}`, checked: false,
        onChange: (checked: boolean) => changes.push([id, checked]),
      }));
      const props = {
        generationResult: failed ? null : mediaResult("video"),
        error: failed ? "Le fournisseur n'a pas terminé" : undefined,
        disabled: true, regenerationConsents: consents,
      };
      const tree = render(props);
      const fieldset = byClass(tree, "regenerationConsent");
      assert.equal(fieldset.type, "fieldset");
      assert.equal(fieldset.props.disabled, false);
      assert.match(text(fieldset), /ai_generator_footer_consent_blocking/);
      const inputs = elements(fieldset).filter((node) => node.type === "input");
      assert.equal(inputs.length, count);
      inputs.forEach((input) => {
        assert.equal(input.props.type, "checkbox");
        assert.equal(input.props.checked, false);
        (input.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
      });
      assert.deepEqual(changes, consents.map((consent) => [consent.id, true]));
      const retryLabel = failed ? "ai_generator_retry" : "ai_generator_regenerate";
      assert.equal(button(tree, retryLabel).props.disabled, true);
      if (!failed) assert.equal(button(tree, "ai_generator_open_library").props.disabled, false);
      // The parent owns eligibility; a new render reflects its newly granted consents.
      const authorized = render({ ...props, disabled: false, regenerationConsents: consents.map((consent) => ({ ...consent, checked: true })) });
      assert.equal(button(authorized, retryLabel).props.disabled, false);
      const locked = render({ ...props, generationResult: mediaResult("video"), operationLocked: true });
      assert.equal(byClass(locked, "regenerationConsent").props.disabled, true);
    }
  }
});

test("sans personne de référence, aucune autorisation vide n'est ajoutée à la revue ou à l'erreur", () => {
  for (const generationResult of [null, mediaResult("image")]) {
    for (const regenerationConsents of [undefined, []]) {
      const tree = render({ generationResult, regenerationConsents });
      assert.equal(elements(tree).some((node) => node.type === "fieldset" || node.type === "input"), false);
    }
  }
});

test("l’aperçu permanent reste vide avant le premier essai sans transformer un upload ou la voix en génération", () => {
  for (const creationStarted of [false, true]) {
    const tree = render({ variant: "embedded", creationStarted, generationInProgress: false, operationLocked: true });
    assert.equal(tree.props["data-media-creation-stage"], "idle");
    assert.match(text(tree), /ai_generator_editor_preview_hint/);
    assert.equal(elements(tree).some((node) => node.props.className === "creationProgress" || node.props.className === "creationErrorPanel" || node.type === "video" || node.type === "img" || node.type === "button"), false);
  }
});

test("la progression intégrée conserve son pourcentage et laisse Stop ainsi que le devis au seul footer", () => {
  const tree = render({ variant: "embedded", creationStarted: true, generationInProgress: true, operationLocked: true, generationCancellable: true, progress: 57,
    engineControls: "CONTROLES_FOOTER", creditSummary: "DEVIS_FOOTER", regenerationConsents: [{ id: "identity", label: "CONSENT_FOOTER", checked: false, onChange() {} }] });
  assert.equal(tree.props["data-media-creation-stage"], "progress");
  assert.equal(text(find(tree, (node) => node.type === "strong")), "57 %");
  assert.equal(elements(tree).some((node) => node.type === "button" || node.type === "fieldset"), false);
  assert.doesNotMatch(text(tree), /CONTROLES_FOOTER|DEVIS_FOOTER|CONSENT_FOOTER/);
});

test("le résultat intégré conserve son type et son format pendant l’édition des prochains réglages", () => {
  const actions: string[] = [];
  const result = mediaResult("video", 1920, 1080);
  const tree = render({ variant: "embedded", creationStarted: true, generationInProgress: false,
    kind: "image", format: "square", generationResult: result, acceptMode: "insert", disabled: true,
    handleConfirm() { actions.push("insert"); }, handleSaveToLibrary() { actions.push("save"); },
    handleGenerate() { actions.push("paid-generation"); }, handleEditCriteria() { actions.push("focus-settings"); },
    engineControls: "CONTROLES_FOOTER", creditSummary: "DEVIS_FOOTER" });
  assert.equal(tree.props["data-media-kind"], "video");
  assert.equal(tree.props["data-media-creation-stage"], "result");
  assert.match(text(tree), /ai_generator_video_ready_title/);
  assert.equal(byClass(tree, "previewFrame").props["data-format"], "landscape");
  assert.equal(find(tree, (node) => node.type === "video").props.src, result.item.signed_url);
  assert.equal(elements(byClass(tree, "resultActions")).filter((node) => node.type === "button").length, 4);
  assert.match(text(tree), /ai_generator_regenerate/);
  assert.equal(button(tree, "ai_generator_regenerate").props.disabled, true);
  assert.doesNotMatch(text(tree), /CONTROLES_FOOTER|DEVIS_FOOTER/);
  click(button(tree, "ai_generator_edit_criteria"));
  click(button(tree, "ai_generator_open_library"));
  click(button(tree, "ai_generator_confirm_insert"));
  assert.deepEqual(actions, ["focus-settings", "save", "insert"]);
});

test("une erreur intégrée affiche le message utile sans dupliquer le bouton payant ni effacer les paramètres", () => {
  const actions: string[] = [];
  const tree = render({ variant: "embedded", creationStarted: true, generationInProgress: false, error: "Le moteur est indisponible",
    handleGenerate() { actions.push("paid-generation"); }, handleEditCriteria() { actions.push("focus-settings"); } });
  assert.equal(tree.props["data-media-creation-stage"], "error");
  assert.match(text(tree), /Le moteur est indisponible/);
  assert.equal(elements(tree).filter((node) => node.type === "button").length, 1);
  click(button(tree, "ai_generator_edit_criteria"));
  assert.deepEqual(actions, ["focus-settings"]);
});

test("les onglets de réglage ne font que sélectionner un panneau et gardent une navigation clavier accessible", () => {
  const selected: string[] = [];
  const tree = record.exports.MediaGenerationSettingsTabs({ idPrefix: "free-image", activeTab: "criteria",
    tabs: [{ id: "criteria", label: "Critères" }, { id: "prompt", label: "Prompt" }], onChange: (id: string) => selected.push(id) });
  assert.equal(tree.props.role, "tablist");
  const criteria = button(tree, "Critères"); const prompt = button(tree, "Prompt");
  assert.equal(criteria.props.type, "button"); assert.equal(criteria.props["aria-selected"], true); assert.equal(criteria.props.tabIndex, 0);
  assert.equal(prompt.props["aria-controls"], "free-image-panel-prompt"); assert.equal(prompt.props.tabIndex, -1);
  click(prompt); assert.deepEqual(selected, ["prompt"]);
  let prevented = false;
  (criteria.props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void)({ key: "ArrowRight", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(selected, ["prompt", "prompt"]);
  assert.equal(focusedElements.at(-1), "free-image-tab-prompt");
});

test("un critère manquant indique précisément son onglet et disparaît une fois complété", () => {
  const selected: string[] = [];
  const props = { idPrefix: "guided-image", activeTab: "subject", onChange: (id: string) => selected.push(id) };
  const tree = record.exports.MediaGenerationSettingsTabs({ ...props,
    tabs: [{ id: "subject", label: "Sujet" }, { id: "finish", label: "Texte", warning: true }] });
  const subject = button(tree, "Sujet"); const finish = button(tree, "Texte");
  assert.equal(subject.props["aria-describedby"], undefined);
  assert.equal(finish.props["aria-label"], "Texte");
  assert.equal(finish.props["aria-describedby"], "guided-image-warning-finish");
  assert.equal(finish.props["aria-controls"], "guided-image-panel-finish");
  const icon = byClass(tree, "tabWarning");
  assert.equal(icon.props["aria-hidden"], "true");
  assert.equal(elements(finish).filter((node) => node.props.className === "tabWarning").length, 1);
  assert.equal(find(tree, (node) => node.props.id === finish.props["aria-describedby"]).props.className, "warningDescription");
  click(finish); assert.deepEqual(selected, ["finish"]);
  const complete = record.exports.MediaGenerationSettingsTabs({ ...props,
    tabs: [{ id: "subject", label: "Sujet" }, { id: "finish", label: "Texte", warning: false }] });
  assert.equal(elements(complete).filter((node) => node.props.className === "tabWarning").length, 0);
  assert.equal(button(complete, "Texte").props["aria-describedby"], undefined);
});

test("une alerte d’onglet explique précisément le champ manquant", () => {
  const reason = "Ajoutez une image de départ pour ce moteur.";
  const tree = record.exports.MediaGenerationSettingsTabs({ idPrefix: "free-video", activeTab: "criteria", onChange() {},
    tabs: [{ id: "prompt", label: "Prompt" }, { id: "criteria", label: "Critères", warning: reason }] });
  const criteria = button(tree, "Critères");
  assert.equal(criteria.props.title, reason);
  assert.equal(criteria.props["aria-label"], "Critères");
  const description = find(tree, (node) => node.props.id === criteria.props["aria-describedby"]);
  assert.equal(text(description), reason);
  assert.doesNotMatch(text(description), /ai_generator_editor_criteria_incomplete/);
});

test("image et vidéo regroupent Enregistrer, Réajuster, Régénérer et Réinitialiser sous l’aperçu", () => {
  for (const kind of ["image", "video"] as const) {
    for (const draft of [true, false]) {
      const actions: string[] = [];
      const props = { variant: "embedded", kind, generationResult: { ...mediaResult(kind), draft },
        editLabel: "Réajuster", handleConfirm: () => actions.push("save"),
        handleEditCriteria: () => actions.push("edit"), handleGenerate: () => actions.push("regenerate"),
        handleReset: () => actions.push("reset"), disabled: false };
      const tree = render(props);
      const buttons = elements(byClass(tree, "resultActions")).filter((node) => node.type === "button");
      assert.deepEqual(buttons.map(text), ["ai_generator_open_library", "Réajuster", "↻ ai_generator_regenerate", "↺ ai_generator_workspace_reset_action"]);
      for (const node of buttons) click(node);
      assert.deepEqual(actions, ["save", "edit", "regenerate", "reset"]);
      for (const disabled of [false, true]) {
        const locked = render({ ...props, operationLocked: true, disabled });
        assert.equal(button(locked, "ai_generator_regenerate").props.disabled, true);
        assert.equal(button(locked, "ai_generator_workspace_reset_action").props.disabled, true);
      }
      const unavailable = render({ ...props, disabled: true });
      assert.equal(button(unavailable, "ai_generator_regenerate").props.disabled, true);
      assert.equal(button(unavailable, "ai_generator_open_library").props.disabled, false);
    }
  }
});
