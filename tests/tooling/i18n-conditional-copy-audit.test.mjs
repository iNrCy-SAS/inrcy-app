import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { directConditionalUiLiteral } from "../../scripts/i18n/ui-text-boundaries.mjs";

function found(code) {
  const source = ts.createSourceFile("fixture.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  const visit = node => {
    if (ts.isStringLiteral(node) && directConditionalUiLiteral(node, name => ["title", "aria-label", "placeholder"].includes(name))) result.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

test("audit finds nested conditional accessible labels and fallback copy", () => {
  assert.deepEqual(found('<button title={active ? "Actions sur ce contact" : selected ? "Actions sur la sélection" : "Sélectionnez un contact"} aria-label={open ? "Réduire" : "Afficher"}>{name || "Ce contact"}</button>'),
    ["Actions sur ce contact", "Actions sur la sélection", "Sélectionnez un contact", "Réduire", "Afficher", "Ce contact"]);
});

test("audit ignores state comparisons, classes, values and translation keys", () => {
  assert.deepEqual(found('<button className={state === "open" ? "active" : "idle"} title={state === "open" ? t("opened") : t("closed")} value={kind ?? "image"}>{t("submit")}</button>'), []);
});
