import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../../app/dashboard/settings/_components/AiMemoryContent.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("l'analyse iNrADN grandit au lieu de masquer son haut ou son bas", () => {
  const styleStart = source.indexOf("const analysisLandingStyle");
  const styleEnd = source.indexOf("const analysisOrbStageStyle", styleStart);
  const analysisStyle = source.slice(styleStart, styleEnd);

  assert.ok(styleStart >= 0);
  assert.ok(styleEnd > styleStart);
  assert.match(analysisStyle, /height: "auto"/);
  assert.match(
    analysisStyle,
    /minHeight: "clamp\(610px, calc\(100svh - 245px\), 780px\)"/,
  );
  assert.match(analysisStyle, /boxSizing: "border-box"/);
  assert.doesNotMatch(
    analysisStyle,
    /height: "clamp\(610px, calc\(100svh - 245px\), 780px\)"/,
  );
});

test("la carte conserve des marges de sécurité distinctes en haut et en bas", () => {
  const styleStart = source.indexOf("const analysisLandingStyle");
  const styleEnd = source.indexOf("const analysisOrbStageStyle", styleStart);
  const analysisStyle = source.slice(styleStart, styleEnd);

  assert.match(
    analysisStyle,
    /padding: "clamp\(28px,[\s\S]*?clamp\(32px, 3\.4vw, 46px\)"/,
  );
});
