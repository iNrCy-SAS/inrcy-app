import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

function readSource(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
}

function evaluate(expression: ts.Expression, source: ts.SourceFile, scope: Record<string, unknown>) {
  const code = ts.transpileModule(`const value = (${expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), `${code}\nreturn value;`)(...Object.values(scope));
}

const intent = readSource("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");
const modal = readSource("app/dashboard/booster/publier/PublishModal.tsx");

test("generation button requires a nonblank subject even with instructions and media", () => {
  let disabled: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(intent) === "button") {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      if (attributes.some((attribute) => attribute.name.getText(intent) === "onClick" &&
        attribute.initializer && ts.isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression?.getText(intent) === "onGenerate")) {
        const attribute = attributes.find((candidate) => candidate.name.getText(intent) === "disabled");
        if (attribute?.initializer && ts.isJsxExpression(attribute.initializer)) disabled = attribute.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(intent);
  assert.ok(disabled);
  for (const [idea, expected] of [["", true], [" \t\n\u00a0 ", true], ["  Nouveau chantier  ", false]] as const) {
    assert.equal(evaluate(disabled, intent, {
      idea, generationDisabled: false, publicationInstruction: "Ton professionnel",
      images: [{}], videoFile: {}, pdfFile: {},
    }), expected);
  }
  assert.equal(evaluate(disabled, intent, { idea: "Nouveau chantier", generationDisabled: true }), true);
});

test("generation handler rejects blank subjects before any engine or media preparation", async () => {
  let handler: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(modal) === "onGenerate") handler = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(modal);
  assert.ok(handler);
  const accepted = new Error("Subject accepted: stop test before generation");
  for (const idea of ["", " \t\n\u00a0 ", "  Nouveau chantier  "]) {
    const errors: string[] = [];
    const noop = () => {};
    const generate = evaluate(handler, modal, {
      generating: false, creationMode: "ai", idea, selectedChannels: ["facebook"],
      publicationInstruction: "Ton professionnel", images: [{}], videoFile: {}, pdfFile: {},
      setGenError: (error: string) => errors.push(error), setImgError: noop,
      setGenerationNotice: noop, setGenerationMediaWarning: noop,
      i18nT: (key: string) => key, selectedAiPreferredEngine: "test",
      getAiEngineOption: () => { throw accepted; },
    }) as () => Promise<void>;
    if (idea.trim()) {
      await assert.rejects(generate, (error) => error === accepted);
      assert.deepEqual(errors, [""]);
    } else {
      await generate();
      assert.equal(errors.at(-1), "ecrivez_une_phrase_ex_chantier_termine_b7125e40");
    }
  }
});

test("generation result notices remain visible after opening the editor without appearing on other steps", () => {
  let outcome: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some((attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(modal) === "data-publish-generation-outcome")) {
      let condition: ts.Node = node.parent;
      while (ts.isJsxElement(condition) || ts.isParenthesizedExpression(condition)) condition = condition.parent;
      assert.ok(ts.isConditionalExpression(condition));
      outcome = condition;
    }
    ts.forEachChild(node, visit);
  }
  visit(modal);
  assert.ok(outcome);
  const render = (activeWizardStep: string, generationNotice = "", generationMediaWarning = "") =>
    renderToStaticMarkup(evaluate(outcome!, modal, {
      React, activeWizardStep, generationNotice, generationMediaWarning,
      intentStyles: { messages: "messages", warning: "warning" },
    }));

  assert.equal(render("content"), "", "ordinary generation leaves all space to the editor");
  for (const step of ["channels", "intention", "media", "control", "publication"]) {
    assert.equal(render(step, "Moteur de secours utilisé", "Analyse média indisponible"), "");
  }
  const both = render("content", "Moteur de secours utilisé", "Analyse média indisponible");
  assert.match(both, /Moteur de secours utilisé/);
  assert.match(both, /Analyse média indisponible/);
  assert.equal((both.match(/role="status"/g) || []).length, 2);
  assert.equal((render("content", "Résultat récupéré").match(/role="status"/g) || []).length, 1);
  assert.equal((render("content", "", "Analyse média indisponible").match(/role="status"/g) || []).length, 1);
});
