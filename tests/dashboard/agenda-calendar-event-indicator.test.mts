import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../../app/dashboard/agenda/agenda.module.css", import.meta.url),
  "utf8",
);

test("iNrCalendar keeps the event indicator in the top-right corner of each day", () => {
  const baseRule = css.match(/\.hasEventsDot\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  assert.match(baseRule, /position:\s*absolute;/);
  assert.match(baseRule, /top:\s*10px;/);
  assert.match(baseRule, /right:\s*10px;/);
  assert.doesNotMatch(baseRule, /left:|bottom:|translateX/);

  assert.match(
    css,
    /@media \(max-width: 980px\)[\s\S]*?\.hasEventsDot\s*\{[\s\S]*?top:\s*5px;[\s\S]*?right:\s*5px;/,
  );
});
