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

const pageSource = readFileSync(
  new URL(
    "../../app/dashboard/adn-entreprise/page.tsx",
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
    /minHeight: "max\(610px, calc\(100svh - 190px\)\)"/,
  );
  assert.match(analysisStyle, /boxSizing: "border-box"/);
  assert.doesNotMatch(
    analysisStyle,
    /780px/,
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

test("l'analyse équilibre son contenu dans le viewport desktop sans créer de scroll de page", () => {
  assert.match(pageSource, /data-analysis-viewport=\{activeWorkspaceTab === "analysis" \? "locked" : undefined\}/);
  assert.match(pageSource, /@media \(min-width: 721px\) and \(min-height: 820px\)/);
  assert.match(pageSource, /\.inrcy-dashboard-shell:has\(main\[data-business-dna-page\]\[data-analysis-viewport="locked"\]\)/);
  assert.match(pageSource, /height: 100svh !important/);
  assert.match(pageSource, /overflow: hidden !important/);
  assert.match(pageSource, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(pageSource, /section\[data-business-dna-channel-analysis\][\s\S]*?height: 100% !important/);
  assert.match(pageSource, /align-content: space-between !important/);
  assert.match(pageSource, /\[data-business-dna-analysis-orb\][\s\S]*?height: 270px !important/);
});
