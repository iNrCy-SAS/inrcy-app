import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const baseModal = read("app/dashboard/_components/WorkflowBaseModal.tsx");
const dashboardStyles = read("app/dashboard/dashboard.module.css");
const propulserPage = read("app/dashboard/propulser/page.tsx");
const fideliserPage = read("app/dashboard/fideliser/page.tsx");

test("Propulser and Fideliser mail campaigns use the full desktop modal width", () => {
  for (const [moduleName, source] of [
    ["Propulser", propulserPage],
    ["Fideliser", fideliserPage],
  ] as const) {
    assert.match(
      source,
      /<BaseModal[\s\S]{0,420}?wideOnDesktop/,
      `${moduleName} must opt into the shared wide desktop workspace`,
    );
  }

  assert.match(baseModal, /wideOnDesktop = false/);
  assert.match(
    baseModal,
    /wideOnDesktop \? styles\.fullscreenModalInnerWideDesktop : ""/,
  );
  assert.match(
    dashboardStyles,
    /@media \(min-width: 1181px\) and \(hover: hover\) and \(pointer: fine\) \{[\s\S]{0,180}?\.fullscreenModalInnerWideDesktop \{[\s\S]{0,100}?max-width: none !important;/,
  );
});

test("the wide campaign workspace remains desktop-only", () => {
  assert.match(
    dashboardStyles,
    /@media \(max-width: 700px\), \(any-hover: none\) and \(any-pointer: coarse\) \{[\s\S]*?\.fullscreenModalInner \{[\s\S]*?max-width: 100%;/,
  );
  assert.doesNotMatch(
    dashboardStyles,
    /@media \(max-width: 1180px\)[\s\S]{0,500}?\.fullscreenModalInnerWideDesktop/,
  );
});
