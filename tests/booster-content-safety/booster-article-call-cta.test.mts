import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBoosterArticleCallCta } from "../../lib/boosterArticleCallCta.ts";

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
  assert.match(renderer, /parseBoosterArticleCallCta\(raw\)/);
  assert.match(renderer, /href="\$\{safeAttr\(call\.href\)\}"/);
});
