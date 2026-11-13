import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parse } from "@formatjs/icu-messageformat-parser";
import { hasCorruptTextEncoding, isUnchangedUtmExample } from "../../scripts/i18n/catalog-text-validation.mjs";

test("genuine Portuguese capitals and French accents remain valid", () => {
  for (const text of ["PRÉ-VISUALIZAÇÃO DO CTA", "AÇÃO E ORGANIZAÇÃO", "ÂNGULO", "Âge", "Français", "ไทย", "中文"]) {
    assert.equal(hasCorruptTextEncoding(text), false, text);
  }
});

test("Latin-1 and Windows-1252 corruption is still rejected", () => {
  for (const text of ["FranÃ§ais", "crÃ©ation", "Â\u00a0", "dâ€™accord", "ï¿½", "Ã—", "�"]) {
    assert.equal(hasCorruptTextEncoding(text), true, text);
  }
});

function validatorFunction(name) {
  const source = ts.createSourceFile("validator.mjs", readFileSync(new URL("../../scripts/i18n/validate-catalogs.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return new Function("parse", `${node.getText(source)}\nreturn ${name};`)(parse);
}

test("plural branches may repeat arguments without requiring redundant Thai or Chinese interpolation", () => {
  const variables = validatorFunction("variables");
  assert.deepEqual(variables("{count} / {total} {total, plural, one {campagne} other {campagnes}}"), ["count", "total"]);
  assert.deepEqual(variables("第 {count} 项，共 {total} 项"), ["count", "total"]);
  assert.notDeepEqual(variables("{count} รายการ"), ["count", "total"]);
});

test("spacing checks preserve Latin word boundaries while respecting Thai and Chinese writing", () => {
  const spacing = validatorFunction("placeholderSpacingErrors");
  const source = "Choisissez {value0} pour {value1}.";
  assert.deepEqual(spacing(source, "Choose{value0} for{value1}.", "en-GB"), ["{value0} avant", "{value1} avant"]);
  assert.deepEqual(spacing(source, "Choose {value0} for {value1}.", "en-GB"), []);
  assert.deepEqual(spacing(source, "เลือก{value0}สำหรับ{value1}.", "th-TH"), []);
  assert.deepEqual(spacing(source, "选择{value0}用于{value1}。", "zh-CN"), []);
});

test("only unchanged technical UTM examples are exempt from French-copy detection", () => {
  const example = "utm_source=google&utm_campaign=devis";
  assert.equal(isUnchangedUtmExample(example, example), true);
  assert.equal(isUnchangedUtmExample(example, "utm_source=google&utm_campaign=quote"), false);
  assert.equal(isUnchangedUtmExample("Votre devis", "Votre devis"), false);
  assert.equal(isUnchangedUtmExample("utm_source=google Veuillez enregistrer", "utm_source=google Veuillez enregistrer"), false);
});
