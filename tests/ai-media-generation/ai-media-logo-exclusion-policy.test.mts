import assert from "node:assert/strict";
import test from "node:test";
import {
  getAiMediaFreeBrandPolicy,
  isAiMediaProfileLogoApplicationRequested,
  usesAiMediaAutomaticImageLogo,
} from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";

const company = "Atelier Test";
function imageRequest(freePrompt: string, hasReference = false) {
  return normalizeAiMediaGenerationRequest({
    requestId: "logo-exclusion-policy-fixture", source: "studio", operation: "generate",
    creationMode: "free", kind: "image", format: "square", useBusinessDna: true, freePrompt,
    inspirationImages: hasReference ? [{ mimeType: "image/jpeg", data: Buffer.alloc(96, 31).toString("base64"), role: "product", usage: "inspiration" }] : [],
  });
}

test("French removal imperatives and polite requests override the automatic ADN logo", () => {
  for (const prompt of [
    "Retire le logo.", "Retirez notre logo.", "Supprime le logo.", "Supprimez mon logo.",
    "Enlève le logo.", "Enlevez notre logo.", "Ôte le logo.", "Omettez le logo.",
    "Peux-tu retirer le logo, s’il te plaît ?", "Pouvez-vous supprimer notre logo ?",
    "Merci d’enlever le logo.", "S’il te plaît, retire simplement le logo.",
    "Je voudrais que tu supprimes le logo.", "Retire-moi ce logo.",
    "Une photographie de bureaux lumineux. Retire le logo.", "Le logo est à enlever.",
    "Sans logos sur les vêtements.", "Retire les logos.", "Supprime nos logos.", "Without logos.",
  ]) {
    assert.equal(getAiMediaFreeBrandPolicy(prompt, company, true).useLogo, false, prompt);
    assert.equal(usesAiMediaAutomaticImageLogo(imageRequest(prompt), company), false, prompt);
    assert.equal(isAiMediaProfileLogoApplicationRequested(prompt, company), false, prompt);
  }
});

test("requests against removing a logo preserve the ADN default without authorizing a new logo in Modify", () => {
  for (const prompt of [
    "Ne retire pas le logo.", "Ne supprime jamais notre logo.", "N’enlève pas notre logo.",
    "N'enlève pas mon logo.", "Ne retirez pas le logo.", "Merci de ne pas retirer le logo.",
    "Merci de ne jamais supprimer notre logo.", "Une photo sans enlever notre logo.",
    "Do not remove our logo.", "Don't remove my logo.",
  ]) {
    assert.equal(getAiMediaFreeBrandPolicy(prompt, company, true).useLogo, true, prompt);
    assert.equal(usesAiMediaAutomaticImageLogo(imageRequest(prompt), company), true, prompt);
    assert.equal(isAiMediaProfileLogoApplicationRequested(prompt, company), false, prompt);
  }
});

test("removing a source logo never implicitly applies the account's official logo", () => {
  for (const prompt of [
    "Retire le logo de cette photo.", "Supprime notre logo dans l’image source.",
    "Merci d’enlever le logo existant sans en ajouter un autre.",
  ]) {
    assert.equal(isAiMediaProfileLogoApplicationRequested(prompt, company), false, prompt);
    assert.equal(getAiMediaFreeBrandPolicy(prompt, company, true).useLogo, false, prompt);
  }
  for (const prompt of [
    "Remplace le faux logo par mon logo enregistré dans Profil.",
    "Ajoute le logo du profil en haut au centre. N’invente pas un nouveau logo.",
  ]) assert.equal(isAiMediaProfileLogoApplicationRequested(prompt, company), true, prompt);
});

test("logo exclusions stay attached to the named object and preserve unrelated brand choices", () => {
  for (const prompt of [
    "Retire le texte, avec notre logo.", "Supprime le cadre, conserve notre logo.",
    "Enlève la photo, utilise notre logo.", "Sans texte, avec notre logo.", "Ne pas oublier le logo.",
  ]) assert.equal(getAiMediaFreeBrandPolicy(prompt, company, true).useLogo, true, prompt);
  for (const prompt of ["Retire le logo.", "Enlève notre logo."]) {
    assert.equal(getAiMediaFreeBrandPolicy(prompt, company, true).useBrandColors, true, prompt);
  }
  const colors = getAiMediaFreeBrandPolicy("Retire les couleurs de marque, avec notre logo.", company, true);
  assert.equal(colors.useLogo, true);
  assert.equal(colors.useBrandColors, false);
});

test("historical explicit exclusions and other owners remain excluded", () => {
  for (const prompt of [
    "Sans logo.", "Aucun logo.", "Sans notre logo.", "Retirer le logo.", "Supprimer le logo.",
    "Ne pas ajouter le logo.", "Ne mets pas de logo.", "Logo interdit.", "Logo à retirer.",
    "Without our logo.", "Use the logo of my client.", "Ajoute le logo du profil de Nike.",
  ]) assert.equal(getAiMediaFreeBrandPolicy(prompt, company, true).useLogo, false, prompt);
});

test("preserving an existing reference logo does not inject a second logo from the profile", () => {
  for (const prompt of [
    "Conserve le logo présent sur la photo de référence.",
    "Garde le logo actuel en haut à droite.", "Préserve notre logo.",
    "Keep the existing logo.", "Ne retire pas notre logo.", "N’enlève pas le logo.",
  ]) {
    assert.equal(getAiMediaFreeBrandPolicy(prompt, company, true, { hasImageReference: true }).useLogo, false, prompt);
    assert.equal(usesAiMediaAutomaticImageLogo(imageRequest(prompt, true), company), false, prompt);
    assert.equal(isAiMediaProfileLogoApplicationRequested(prompt, company), false, prompt);
  }
  assert.equal(usesAiMediaAutomaticImageLogo(imageRequest("Garde notre logo en haut à droite."), company), true);
  assert.equal(usesAiMediaAutomaticImageLogo(imageRequest("Ajoute le logo du profil en haut à droite.", true), company), true);
});
