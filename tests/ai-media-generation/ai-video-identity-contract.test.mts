import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("le prompt vidéo distingue le professionnel, l’avatar et le mode générique", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");

  assert.match(veo, /buildGoogleVideoIdentityDirection/);
  assert.match(veo, /IDENTITY LOCK — APPROVED REAL PROFESSIONAL/);
  assert.match(veo, /IDENTITY LOCK — APPROVED BRAND AVATAR/);
  assert.match(veo, /general visual inspiration only/);
  assert.match(
    veo,
    /never replace the professional with a generic or different person/
  );
  assert.match(veo, /PUNCTUAL USER DIRECTION FOR THIS GENERATION ONLY/);
});

test("les références d’identité restent actives sur chaque segment et chaque fournisseur", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  for (const provider of [veo, omni]) {
    assert.match(provider, /preserveIdentityReferences \|\| index === 0/);
    assert.match(provider, /videoCharacterMode === "professional"/);
    assert.match(provider, /videoCharacterMode === "brand_avatar"/);
    assert.match(provider, /videoCharacterMode === "reference_team"/);
    assert.match(provider, /identityTeamPrecomposed/);
    assert.match(provider, /ai_video_reference_team_precomposition_required/);
  }

  assert.match(
    veo,
    /inspirationImages\.length && args\.preserveIdentityReferences[\s\S]*?\[\{ prompt: args\.prompt, inspirationImages \}\]/
  );
  assert.match(
    omni,
    /args\.inspirationImages\.length && args\.preserveIdentityReferences[\s\S]*?images: args\.inspirationImages/
  );
});

test("un fournisseur qui refuse l’identité échoue explicitement sans rendu générique", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");
  const route = read("app/api/media-generation/generate/route.ts");

  for (const provider of [veo, omni]) {
    assert.match(provider, /ai_video_identity_reference_rejected/);
  }
  assert.match(
    veo,
    /const canRetryWithoutInspiration =\s*!args\.preserveIdentityReferences/
  );
  assert.match(
    omni,
    /const canDropInspiration =\s*!args\.preserveIdentityReferences/
  );
  assert.match(route, /AI_MEDIA_VIDEO_IDENTITY_REFERENCE_REJECTED/);
  assert.match(route, /Aucune personne générique n’a été substituée/);
});
