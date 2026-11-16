import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBoosterArticleCallCta, parseBoosterArticleCallCtas } from "../../lib/boosterArticleCallCta.ts";

test("site article Appeler CTA keeps the visible number and a safe dial target", () => {
  assert.deepEqual(parseBoosterArticleCallCta("Appeler : 06 12 34 56 78"), {
    label: "Appeler",
    phone: "06 12 34 56 78",
    href: "tel:0612345678",
  });
  assert.deepEqual(parseBoosterArticleCallCta("Appelez-nous : +33 (0)6 12 34 56 78"), {
    label: "Appelez-nous",
    phone: "+33 (0)6 12 34 56 78",
    href: "tel:+33612345678",
  });
  assert.equal(parseBoosterArticleCallCta("Appeler : 12"), null);
  assert.equal(parseBoosterArticleCallCta("Appeler : javascript:alert(1)"), null);

  const renderer = readFileSync(new URL("../../app/embed/actus/_lib/render.ts", import.meta.url), "utf8");
  assert.match(renderer, /parseBoosterArticleCallCtas\(raw\)/);
  assert.match(renderer, /href="\$\{safeAttr\(call\.href\)\}"/);
});

test("site article calls keep two separate telephone links without a combined dial target", () => {
  assert.deepEqual(parseBoosterArticleCallCtas("Appeler : +243981837026 / +8618666071730"), [
    {label:"Appeler",phone:"+243981837026",href:"tel:+243981837026"},
    {label:"Appeler",phone:"+8618666071730",href:"tel:+8618666071730"},
  ]);
  assert.equal(parseBoosterArticleCallCta("Appeler : +243981837026 / +8618666071730"), null);
  assert.deepEqual(parseBoosterArticleCallCtas("Appeler : +243981837026 / javascript:alert(1)"), []);
});
