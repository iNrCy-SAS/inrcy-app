import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('Every native signed preview is wrapped by the Gateway private-token and approval contract', () => {
  const root = new URL('../../lib/', import.meta.url);
  const gateway = ts.createSourceFile('gateway.ts', readFileSync(new URL('inrAssistantGateway.ts', root), 'utf8'), ts.ScriptTarget.Latest, true);
  const registered = new Set<string>();
  function inspect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(gateway) === 'previewActionNames' && node.initializer && ts.isNewExpression(node.initializer)) {
      const list = node.initializer.arguments?.[0];
      if (list && ts.isArrayLiteralExpression(list)) for (const item of list.elements) if (ts.isStringLiteral(item)) registered.add(item.text);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(gateway); assert.ok(registered.has('previewNotificationRemoval')); assert.ok(registered.has('previewPublishedPublicationEdit'));
  let checked = 0;
  for (const file of readdirSync(root).filter(name => /^inrAssistant.*Tools\.ts$/.test(name))) {
    const source = readFileSync(new URL(file, root), 'utf8');
    if (!source.includes('createAssistantActionPreview')) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && /^preview[A-Z]/.test(node.name.getText(ast)) && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'tool') {
        checked++; assert.ok(registered.has(node.name.getText(ast)), `${file}: signed preview must be registered before its private token can reach the model`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.ok(checked >= 15, 'the test inspects real native preview definitions');
});
