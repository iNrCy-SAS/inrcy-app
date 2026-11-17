import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { userFacingErrorsFixture } from "../helpers/user-facing-errors-fixture.mts";

type ErrorAction = { status: string; lastError?: string | null };
const file = new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url);
const source = ts.createSourceFile("AgentClient.tsx", readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, ts.FunctionDeclaration>();
let failureBinding: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "publishFailureMessage") failureBinding = node.initializer;
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of ["publicationFailureMessage", "PublicationFailureNotice", "isAgentActionAwaitingValidation"]) assert.ok(declarations.has(name), name);
assert.ok(failureBinding);
const javascript = ts.transpileModule([...declarations.entries()].filter(([name]) => ["publicationFailureMessage", "PublicationFailureNotice", "isAgentActionAwaitingValidation"].includes(name)).map(([, node]) => node.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const { message, Notice, canReview } = new Function("getLocalizedErrorMessage", "styles", "React", "asRecord", "pendingActionStatuses", javascript + ";return {message:publicationFailureMessage,Notice:PublicationFailureNotice,canReview:isAgentActionAwaitingValidation};")(
  userFacingErrorsFixture.getLocalizedErrorMessage, { publishTextUrlError: "publication-error" }, { createElement },
  (value: unknown) => value && typeof value === "object" ? value : null, new Set(["prepared", "pending_validation", "pending"]),
) as {
  message: (action: ErrorAction | null, locale: string) => string | null;
  Notice: (props: { message: string | null }) => ReturnType<typeof createElement> | null;
  canReview: (action: ErrorAction & { validationRequired: boolean; payload: Record<string, unknown> }) => boolean;
};
const visible = new Function("isPublishView", "selectedPreparedAction", "locale", "publicationFailureMessage", "return (" + failureBinding.getText(source) + ");") as
  (view: boolean, action: ErrorAction | null, locale: string, format: typeof message) => string | null;
const mediaFailure = "Le média de cette publication n’a pas pu être préparé. Réessayez dans quelques instants.";
function render(value: string | null) { return renderToStaticMarkup(createElement(Notice, { message: value })); }

test("l’aperçu affiche le motif média public réel pour une préparation échouée", () => {
  const action = { status: "failed", lastError: mediaFailure };
  const copy = visible(true, action, "fr-FR", message);
  assert.equal(copy, mediaFailure);
  const html = render(copy);
  assert.match(html, /role="alert"/);
  assert.match(html, /Le média de cette publication/);
  assert.equal(action.status, "failed");
  assert.equal(canReview({ ...action, validationRequired: true, payload: {} }), false);
});

test("les autres statuts et les autres outils ne présentent aucune alerte persistante", () => {
  assert.equal(message(null, "fr-FR"), null);
  for (const status of ["draft", "executing", "prepared", "pending_validation", "validated", "scheduled", "completed", "refused", "cancelled"]) {
    assert.equal(render(visible(true, { status, lastError: mediaFailure }, "fr-FR", message)), "");
  }
  assert.equal(render(visible(false, { status: "failed", lastError: mediaFailure }, "fr-FR", message)), "");
});

test("les causes connues de délai et de crédits gardent une explication exploitable", () => {
  assert.match(message({ status: "failed", lastError: "deadline exceeded" }, "fr-FR")!, /trop de temps/);
  assert.match(message({ status: "failed", lastError: "insufficient_credits" }, "fr-FR")!, /solde|crédits|recharge/);
  assert.ok(message({ status: "failed" }, "fr-FR"));
});

test("aucun diagnostic brut, token, HTML ou URL privée ne traverse l’affichage", () => {
  const diagnostics = [
    "Authorization: Bearer sensitive-example",
    "PGRST116: private database error",
    "Le média privé est introuvable https://private.example.test/storage/object?token=sensitive-example",
    "Erreur sur le chemin https://private.example.test/internal-path",
    "{\"error\":\"private-provider-response\",\"secret\":\"sensitive-example\"}",
    "<img src=x onerror=alert('sensitive-example')>",
    mediaFailure + " token=sensitive-example",
    "Une erreur inconnue contient sensitive-example.",
  ];
  for (const lastError of diagnostics) {
    const copy = message({ status: "failed", lastError }, "fr-FR");
    assert.ok(copy);
    assert.doesNotMatch(copy, /sensitive-example|private|PGRST|https?:|<img|token=|Bearer/i);
    assert.match(render(copy), /role="alert"/);
  }
  const html = render("<script>alert('test')</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("les diagnostics reconnus et le repli restent localisés dans les neuf langues", () => {
  const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
  const copies = locales.map(locale => message({ status: "failed", lastError: "deadline exceeded" }, locale));
  assert.equal(new Set(copies).size, locales.length);
  for (const locale of locales.slice(1)) {
    const copy = message({ status: "failed", lastError: mediaFailure }, locale)!;
    assert.ok(copy);
    assert.doesNotMatch(copy, /Le média de cette publication/);
  }
});
