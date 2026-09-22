import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

function sourceFiles(relativeDirectory: string): string[] {
  const directory = path.join(ROOT, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(?:ts|tsx|mts|mjs)$/u.test(entry.name) ? [relative] : [];
  });
}

test("les entrées Studio et iNrAgent utilisent le même pipeline média central", () => {
  const studioRoute = read("app/api/media-generation/generate/route.ts");
  const agent = read("lib/inrAgentMediaGeneration.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  for (const source of [studioRoute, agent]) {
    assert.match(source, /generateAndSaveAiMedia/);
    assert.doesNotMatch(source, /from ["']@\/lib\/aiMediaGateway["']/);
    assert.doesNotMatch(source, /from ["']@\/lib\/aiVideoProvider/);
    assert.doesNotMatch(source, /experimental_generateImage|new GoogleGenAI/);
  }
  assert.match(server, /buildAiMediaPrompt\(\{/);
  assert.match(server, /AI_MEDIA_PROMPT_VERSION/);
});

test("aucune route API ni écran Booster ne contourne le compositeur média", () => {
  const forbiddenImport =
    /from ["']@\/lib\/(?:aiMediaGateway|aiVideoProvider(?:GoogleOmni|GoogleVeo)?)["']/u;
  const forbiddenSdkCall =
    /experimental_generateImage|\.models\.generateVideos\s*\(|\.interactions\.create\s*\(/u;
  const files = [
    ...sourceFiles("app/api"),
    ...sourceFiles("app/dashboard/booster"),
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, forbiddenImport, file);
    assert.doesNotMatch(source, forbiddenSdkCall, file);
  }
});

test("les secours actifs ne réinjectent aucun ancien slogan média", () => {
  const activeFallbacks = [
    read("lib/aiMediaCreativePlan.ts"),
    read("lib/aiMediaNarration.ts"),
  ].join("\n");
  const banned = [
    /Votre projet entre de bonnes mains/iu,
    /Votre projet prend vie/iu,
    /Cap sur /iu,
    /au service de votre projet/iu,
    /Découvrez notre expertise/iu,
    /Discover our expertise/iu,
    /Une solution complète/iu,
    /Une étape concrète/iu,
  ];
  for (const phrase of banned) assert.doesNotMatch(activeFallbacks, phrase);

  const copywriter = read("lib/aiMediaCopywriter.ts");
  assert.match(copywriter, /Tout texte visible ou prononcé passe par ce contrat éditorial central/);
  assert.doesNotMatch(
    copywriter,
    /languageCode === "fr"[\s\S]{0,400}return args\.plan/
  );
});

test("le secours de narration varie avec la requête et reste factuel", () => {
  const narration = read("lib/aiMediaNarration.ts");
  assert.match(narration, /update\(args\.request\.requestId\)/);
  assert.match(narration, /business\.services/);
  assert.match(narration, /business\.strengths/);
  assert.match(narration, /isAiMediaTechnicalCopyAllowed/);
  assert.match(narration, /if \(!script\) return null/);
});
