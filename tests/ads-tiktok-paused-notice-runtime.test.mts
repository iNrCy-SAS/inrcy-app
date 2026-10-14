import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Check = { ready: boolean; pausedCreationEnabled: boolean; blockers: string[] };
type State = { draftKey: string; check: Check | null; error: string };
type Element = { type: unknown; props: Record<string, unknown> };

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found?.initializer, `Missing actual UI declaration ${name}`);
  return `const ${found.getText(source)};`;
}
const compiledState = ts.transpileModule([
  declaration("preparedNativeCheck"), declaration("preparedNativeReady"), declaration("tikTokPausedNotice"),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const actualNotice = new Function("draft", "channelId", "preparedNativeReadiness", `${compiledState}\nreturn { notice: tikTokPausedNotice, ready: preparedNativeReady };`) as (
  draft: Record<string, unknown>, channel: string, state: State,
) => { notice: { title: string; message: string } | null; ready: boolean };

function jsxNode(predicate: (node: ts.JsxElement) => boolean) {
  let found: ts.JsxElement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && predicate(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, "Missing actual readiness UI");
  return found;
}
const noticeNode = jsxNode((node) => node.openingElement.attributes.properties.some((attribute) =>
  ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className"
  && attribute.initializer?.getText(source) === "{styles.draftOnlyWarning}"));
const buttonNode = jsxNode((node) => node.openingElement.attributes.properties.some((attribute) =>
  ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "data-prepared-final-validation"));
function render(node: ts.JsxElement, scope: Record<string, unknown>): Element {
  const compiled = ts.transpileModule(`export const rendered = (${node.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded: { rendered?: Element } = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  new Function("exports", "require", ...Object.keys(scope), compiled)(loaded, (specifier: string) => {
    assert.equal(specifier, "react/jsx-runtime");
    return { jsx, jsxs: jsx };
  }, ...Object.values(scope));
  assert.ok(loaded.rendered);
  return loaded.rendered;
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function runtime(check: Check | null, options: { channel?: string; error?: string; stale?: boolean; button?: Record<string, unknown> } = {}) {
  const draft = { provider: options.channel || "tiktok", creationMode: "manual" };
  const state = actualNotice(draft, draft.provider, { draftKey: options.stale ? "previous-draft" : JSON.stringify(draft), check, error: options.error || "" });
  let confirmations = 0;
  let draftSaves = 0;
  const scope = {
    draft, channelId: draft.provider, channelMeta: { label: draft.provider === "tiktok" ? "TikTok Ads" : "X Ads" },
    tikTokPausedNotice: state.notice, preparedNativeReady: state.ready,
    styles: { draftOnlyWarning: "notice", primaryButton: "primary" }, busy: null, preparedReviewIssues: [],
    preparedBudgetApprovalKey: "current", preparedDraftKey: "current", preparedContentApprovalKey: "current",
    destinationReview: { required: true, confirmed: true },
    openPreparedLaunchDialog: () => { confirmations += 1; },
    validatePreparedDraft: () => { draftSaves += 1; },
    ...options.button,
  };
  const notice = render(noticeNode, scope);
  const button = render(buttonNode, scope);
  return { notice: text(notice), label: text(button), disabled: button.props.disabled,
    click: () => { if (!button.props.disabled) (button.props.onClick as () => void)(); },
    confirmations: () => confirmations, draftSaves: () => draftSaves };
}

test("un préflight TikTok courant et autorisé annonce seulement la création en pause", () => {
  const h = runtime({ ready: true, pausedCreationEnabled: true, blockers: [] });
  assert.match(h.notice, /Création en pause disponible/);
  assert.match(h.notice, /Après votre confirmation/);
  assert.match(h.notice, /sans diffusion ni dépense publicitaire/);
  assert.doesNotMatch(h.notice, /Brouillon uniquement/);
  assert.match(h.label, /Créer en pause/);
  assert.equal(h.disabled, false);
  assert.equal(h.confirmations(), 0);
  h.click();
  assert.equal(h.confirmations(), 1, "The click opens the existing confirmation only");
  assert.equal(h.draftSaves(), 0);
});

test("une connexion TikTok sans activation de création reste un brouillon, avec une raison compréhensible", () => {
  const h = runtime({ ready: false, pausedCreationEnabled: false, blockers: ["paused_creation_disabled", "identity_required", "thumbnail_required"] });
  assert.match(h.notice, /Création en pause à vérifier/);
  assert.match(h.notice, /n’a pas encore été activée dans iNrCy/);
  assert.match(h.notice, /Connecter votre compte ne suffit pas/);
  assert.doesNotMatch(h.notice, /paused_creation_disabled|INRCY_|flag|identity_required|thumbnail_required/);
  assert.match(h.label, /Enregistrer le brouillon/);
  h.click();
  assert.equal(h.confirmations(), 0);
  assert.equal(h.draftSaves(), 1);
});

test("les autorisations manquantes et les prérequis TikTok renvoient aux contrôles existants", () => {
  const permission = runtime({ ready: false, pausedCreationEnabled: true, blockers: ["native_capabilities_unverified"] });
  assert.match(permission.notice, /TikTok doit encore confirmer les autorisations/);
  assert.doesNotMatch(permission.notice, /Création en pause disponible|native_capabilities_unverified/);
  const resources = runtime({ ready: false, pausedCreationEnabled: true, blockers: ["identity_required", "location_required", "thumbnail_required"] });
  assert.match(resources.notice, /vérifications du compte, de l’identité, des zones et de la vidéo indiquées ci-dessus/);
  assert.doesNotMatch(resources.notice, /Création en pause disponible/);
});

test("un résultat périmé ou une autorisation de pause absente ne rend jamais la création disponible", () => {
  for (const h of [runtime(null), runtime({ ready: true, pausedCreationEnabled: true, blockers: [] }, { stale: true }), runtime({ ready: true, pausedCreationEnabled: false, blockers: [] })]) {
    assert.doesNotMatch(h.notice, /Création en pause disponible/);
    assert.match(h.label, /Enregistrer le brouillon/);
    h.click();
    assert.equal(h.confirmations(), 0);
  }
});

test("l’erreur du préflight courant apparaît, sans reprendre celle d’un autre brouillon", () => {
  const h = runtime(null, { error: "TikTok n’a pas permis de vérifier cette campagne." });
  assert.match(h.notice, /TikTok n’a pas permis de vérifier cette campagne/);
  assert.match(h.notice, /brouillon reste enregistrable/);
  const stale = runtime(null, { error: "Erreur précédente", stale: true });
  assert.doesNotMatch(stale.notice, /Erreur précédente/);
});

test("les validations de budget, contenu, destination et état occupé restent obligatoires", () => {
  for (const button of [
    { busy: "save" }, { preparedReviewIssues: ["Missing video"] },
    { preparedBudgetApprovalKey: "old" }, { preparedContentApprovalKey: "old" },
    { destinationReview: { required: true, confirmed: false } },
  ]) {
    const h = runtime({ ready: true, pausedCreationEnabled: true, blockers: [] }, { button });
    assert.equal(h.disabled, true);
    h.click();
    assert.equal(h.confirmations(), 0);
    assert.equal(h.draftSaves(), 0);
  }
});

test("le libellé X et sa logique de validation existante restent inchangés", () => {
  const ready = runtime({ ready: true, pausedCreationEnabled: true, blockers: [] }, { channel: "x" });
  assert.match(ready.notice, /Brouillon uniquement pour le moment/);
  assert.match(ready.label, /VALIDER/);
  assert.doesNotMatch(ready.label, /Créer en pause/);
  const pending = runtime(null, { channel: "x" });
  assert.match(pending.label, /VALIDER LE BROUILLON/);
});
