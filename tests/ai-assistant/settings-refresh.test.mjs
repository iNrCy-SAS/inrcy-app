import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function refreshCallback(file, context) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../../app/dashboard/settings/_components/${file}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useInrAssistantRefresh") callback = node.arguments[0].properties.find(property => property.name?.getText(source) === "refresh").initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(callback);
  return vm.runInNewContext(ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

for (const file of ["InrBadgeSettingsContent.tsx", "NotificationsSettingsContent.tsx"]) {
  test(`${file}: assistant reread updates only the current idle account and never writes remotely`, async () => {
    for (const mode of ["apply", "account_changed", "saving", "late_edit", "draft"]) {
      const applied = [], requests = []; let account = "a";
      const saveRevision = { current: 0 }, pendingSavesRef = { current: 0 }, savingRef = { current: false }, assistantReadOnly = { current: false };
      const fresh = { phone: false, email_enabled: false };
      const callback = refreshCallback(file, {
        profile: { userId: "a" }, trim: value => String(value || "").trim(), getActiveBrowserUserId: () => account,
        saveRevision, pendingSavesRef, savingRef, assistantReadOnly, dashboardEdition: "standard", storageKey: "a", appointmentSettings: {}, selectedMailAccountId: "",
        normalizeInrBadgeShareSettings: value => value, effectiveInrBadgeShareSettings: value => value,
        setSettings: value => applied.push(value), setPrefs: value => applied.push(value), saveBadgeSettings: () => {},
        fetch: async (url, options) => { requests.push({ url, options }); if (mode === "account_changed") account = "b"; if (mode === "saving") { pendingSavesRef.current = 1; savingRef.current = true; } if (mode === "late_edit") saveRevision.current++; return { ok: true, json: async () => ({ settings: fresh, preferences: fresh }) }; },
      });
      assert.equal(await callback({ accountId: "a", canApply: () => mode !== "draft" }), mode === "apply", mode);
      assert.deepEqual(applied, mode === "apply" ? [fresh] : []);
      assert.equal(requests.length, 1); assert.equal(requests[0].options.method, undefined);
      if (file.startsWith("InrBadge") && mode === "apply") assert.equal(assistantReadOnly.current, true);
    }
  });
}
