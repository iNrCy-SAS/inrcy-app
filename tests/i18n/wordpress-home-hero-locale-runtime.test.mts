import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "docs", "wordpress", "inrcy-home-hero-locale-runtime.php"),
  "utf8",
);

test("the WordPress homepage hero runtime covers every supported site language", () => {
  for (const locale of ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"]) {
    assert.match(source, new RegExp(`\\n\\s{4}${locale}: \\{`));
  }

  for (const label of [
    "Published",
    "Publicado",
    "Pubblicato",
    "Veröffentlicht",
    "Gepubliceerd",
    "เผยแพร่แล้ว",
    "已发布",
  ]) {
    assert.ok(source.includes(`published: '${label}'`), `${label} is missing`);
  }
});

test("the hero runtime follows the page locale and survives Elementor mutations", () => {
  assert.match(source, /document\.documentElement\.lang/);
  assert.match(source, /window\.location\.pathname/);
  assert.match(source, /root\.setAttribute\('data-no-translation', ''\)/);
  assert.match(source, /root\.setAttribute\('data-no-dynamic-translation', ''\)/);
  assert.match(source, /new MutationObserver\(schedule\)/);
  assert.doesNotMatch(source, /childList: true/);
  assert.doesNotMatch(source, /characterData: true/);
  assert.match(source, /index === 7/);
  assert.match(source, /index === 9/);
  assert.match(source, /channel\.classList\.contains\('active'\)/);
  assert.match(source, /window\.addEventListener\('pageshow', applyLocale\)/);
});
