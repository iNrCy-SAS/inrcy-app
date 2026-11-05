import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { assertBasicReceiptContract, gatewayReceiptRecorder } from "./helpers/basic-receipt-contract.mts";
test("the actual Gateway rejects missing mutation messages, so factory receipt checks must fail on that regression", () => {
  const output = { ok: true, status: "saved" }, observer = gatewayReceiptRecorder("updateSocialPublicationPreferences");
  assert.equal(observer.record({ toolName: "updateSocialPublicationPreferences", toolCallId: "missing-message", output }), false); assert.equal(observer.receipts.length, 0);
  assert.throws(() => assertBasicReceiptContract("updateSocialPublicationPreferences", output), /verifiable receipt message/);
});
test("the actual Gateway keeps private capabilities when the public preview has a meaningful confirmation message", () => {
  const reference = "IA-123456ABCDEF";
  assertBasicReceiptContract("previewWebsiteReset", { ok: true, status: "preview_ready", reference, token: "private-signed-capability", approvalKind: "website_reset", message: `La réinitialisation attend votre validation. Dites « Confirme ${reference} ». Aucune réinitialisation effectuée.` });
});
test("every literal successful result in Basic identity/channel factories declares its receipt message", () => {
  const modules = ["BusinessIdentity", "ChannelConfiguration", "NativePresentation", "BusinessDnaSource", "Website", "SocialPublicationPreferences", "PinterestBoard", "WebsiteLifecycle", "DnaSchedule", "GeneratorSettings", "BadgeUi", "WebsiteUi", "ChannelAction"];
  for (const name of modules) {
    const path = `inrAssistant${name}Tools.ts`, source = ts.createSourceFile(path, readFileSync(new URL(`../../lib/${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let checked = 0;
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const property = (key: string) => node.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(source) === key) as ts.PropertyAssignment | undefined;
        if (property("ok")?.initializer.kind === ts.SyntaxKind.TrueKeyword) {
          const message = property("message"), line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          assert.ok(message, `${path}:${line}: success must carry a message before it can enter the Gateway journal`);
          if (ts.isStringLiteralLike(message.initializer)) assert.ok(message.initializer.text.trim(), `${path}:${line}: message cannot be empty`);
          checked++;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source); assert.ok(checked > 0, path);
  }
});
