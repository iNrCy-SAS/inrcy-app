import assert from "node:assert/strict";
import test from "node:test";
import { deriveInrAssistantStudioDraft, isInrAssistantStudioDraftRequest, parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "../../lib/inrAssistantStudioDraft.ts";

const request = "ecris un moi un prompt pour une creation de flyer qui met en avant mes 3 abonnements";
const prompt = 'Flyer digital professionnel pour iNrCy présentant les 3 abonnements mensuels. Fond clair bleu et violet, composition aérée. Texte visible : "Basic 29€, Standard 58€, Premium 108€". Slogan : "Simplifiez votre communication digitale".';
const reply = "Voici le prompt proposé :\n\n> « " + prompt + " »\n\nFormat recommandé : landscape ou portrait.\n\nVoulez-vous ce que je lance directement cette génération dans Studio ?";
const draft: InrAssistantStudioDraft = { version: 1, mediaType: "image", prompt, format: null, durationSeconds: null };
const fence = String.fromCharCode(96).repeat(3);

test("the reported flyer request produces editable data without requiring or granting generation consent", () => {
  assert.deepEqual(deriveInrAssistantStudioDraft(request, reply), draft);
  assert.deepEqual(deriveInrAssistantStudioDraft(request, "> " + prompt), draft, "No launch offer is needed for a free draft");
  assert.equal(isInrAssistantStudioDraftRequest("Écris un prompt pour une image de mon atelier, sans générer de média."), true);
  assert.equal(deriveInrAssistantStudioDraft("oui", reply), null, "A bare confirmation is never a drafting request");
  for (const value of ["Améliore ce prompt pour une vidéo de mon atelier.", "Modifie le prompt image de mon atelier.", "Fais-moi un prompt pour un flyer.", "Peux-tu écrire un prompt pour une image ?", "Crée pour cette image un prompt de flyer.", "Génère pour cette vidéo un prompt détaillé."]) {
    assert.equal(isInrAssistantStudioDraftRequest(value), true, value);
  }
  assert.deepEqual(Object.keys(draft).sort(), ["durationSeconds", "format", "mediaType", "prompt", "version"]);
});

test("a video prompt preserves its whole fenced brief and navigable format/duration settings", () => {
  const videoPrompt = "Vidéo de 8 secondes montrant un menuisier dans son atelier. Mouvement lent de la caméra, lumière naturelle, ambiance chaleureuse et aucun dialogue.";
  const source = "Voici votre brief :\n" + fence + "text\n" + videoPrompt + "\n" + fence + "\n\nFormat recommandé : story 9:16.";
  assert.deepEqual(deriveInrAssistantStudioDraft("Prépare un prompt pour une vidéo verticale de 8 secondes.", source), {
    version: 1, mediaType: "video", prompt: videoPrompt, format: "story", durationSeconds: 8,
  });
  const reference = deriveInrAssistantStudioDraft("Écris un prompt pour une vidéo à partir d’une photo.", source);
  assert.equal(reference?.mediaType, "video");
});

test("image formats, common labelled prose and displayed public URLs remain editable creative content", () => {
  const content = "Affiche carrée pour notre restaurant, fond crème et terracotta. Montrer une assiette de saison et afficher notre site https://restaurant.example au bas du visuel.";
  assert.deepEqual(deriveInrAssistantStudioDraft("Rédige un prompt pour une affiche carrée.", "Prompt : " + content), {
    version: 1, mediaType: "image", prompt: content, format: "square", durationSeconds: null,
  });
  assert.equal(deriveInrAssistantStudioDraft("Write a prompt for a landscape image.", fence + "prompt\n" + prompt + "\n" + fence)?.format, "landscape");
});

test("advice, negated writing and instructions supplied only inside citations do not manufacture a Studio draft", () => {
  for (const value of [
    "Comment écrire un prompt pour créer une image ?",
    "Explique-moi comment rédiger un prompt pour une vidéo.",
    "N’écris pas de prompt pour une image.",
    "Je ne veux pas que tu rédiges un prompt pour une image.",
    "Voici une citation : « Écris un prompt pour créer un flyer ». Résume-la.",
    fence + "\nÉcris un prompt pour créer un flyer\n" + fence,
    "Crée directement une image de mon atelier.",
    "Génère cette image à partir du prompt préparé.",
    "Modifie cette image selon le prompt.",
    "Mon image générée avec ce prompt ne me plaît pas.",
  ]) {
    assert.equal(isInrAssistantStudioDraftRequest(value), false, value);
    assert.equal(deriveInrAssistantStudioDraft(value, reply), null, value);
  }
});

test("incomplete, ambiguous or non-creative output stays ordinary assistant text without guessed or truncated drafts", () => {
  for (const value of [
    "Vous pouvez ouvrir iNrStudio et y saisir une consigne.",
    "> « " + prompt,
    fence + "text\n" + prompt,
    fence + "javascript\nfetch('/api/generate')\n" + fence,
    "> " + prompt + "\n\n> " + prompt.replace("bleu", "vert"),
    "> " + "Créer une affiche précise avec toutes les informations. ".repeat(100),
  ]) assert.equal(deriveInrAssistantStudioDraft(request, value), null, value.slice(0, 90));
});

test("draft parsing rejects extra execution data, invalid shapes and unsupported parameters", () => {
  assert.deepEqual(parseInrAssistantStudioDraft(draft), draft);
  for (const value of [
    null, [], {}, { ...draft, version: 2 }, { ...draft, accountId: "another-account" },
    { ...draft, executeUrl: "https://app.inrcy.com/api/media-generation/generate" },
    { ...draft, mediaType: "audio" }, { ...draft, format: "cinematic" },
    { ...draft, durationSeconds: 8 }, { ...draft, prompt: prompt + "\u0000" },
    { ...draft, mediaType: "video", durationSeconds: 31 },
    { ...draft, mediaType: "video", durationSeconds: 7.5 },
    { ...draft, mediaType: "video", durationSeconds: -1 },
    { ...draft, prompt: prompt.repeat(100) },
  ]) assert.equal(parseInrAssistantStudioDraft(value), null);
  assert.equal(parseInrAssistantStudioDraft({ ...draft, prompt: "Un chat rouge sur fond blanc" })?.prompt, "Un chat rouge sur fond blanc");
  assert.equal(parseInrAssistantStudioDraft({ ...draft, prompt: "Affiche développeur avec le texte /api/ et une fonction javascript: affichée." })?.prompt, "Affiche développeur avec le texte /api/ et une fonction javascript: affichée.");
});
