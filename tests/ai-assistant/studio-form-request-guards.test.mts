import assert from "node:assert/strict";
import test from "node:test";
import { isInrAssistantStudioFormSelectionRequested } from "../../lib/inrAssistantStudioFormSelection.ts";
import { isInrAssistantScheduledEditorValueRequested, parseInrAssistantScheduledOptionSelection, parseInrAssistantScheduledTextSelection } from "../../lib/inrAssistantScheduledEditorSelection.ts";
const encode = (field: string, value: unknown) => JSON.stringify({ field, value });

test("Studio field request guards bind each requested native format including quoted values and reject an inverse valid enum", () => {
  for (const [label, value] of [["carré", "square"], ["1:1", "square"], ["portrait", "portrait"], ["4:5", "portrait"], ["story", "story"], ["9:16", "story"], ["paysage", "landscape"], ["16:9", "landscape"]]) {
    for (const candidate of ["square", "portrait", "story", "landscape"]) {
      assert.equal(isInrAssistantStudioFormSelectionRequested(`Mets le format du Studio libre en ${label}.`, encode("format", candidate)), candidate === value, `${label}: ${candidate}`);
      assert.equal(isInrAssistantStudioFormSelectionRequested(`Choisis le format « ${label} » dans le formulaire Studio guidé.`, encode("format", candidate)), candidate === value, `quoted ${label}: ${candidate}`);
    }
  }
  assert.equal(isInrAssistantStudioFormSelectionRequested('Mets le format carré du Studio avec le texte « story ».', encode("format", "story")), false);
  assert.equal(isInrAssistantStudioFormSelectionRequested('« Mets le format carré du Studio. »', encode("format", "square")), false);
  assert.equal(isInrAssistantStudioFormSelectionRequested("Change la consigne du Studio.", encode("format", "square")), false);
  assert.equal(isInrAssistantStudioFormSelectionRequested("Mets le format carré du Studio puis choisis un style portrait.", encode("format", "portrait")), false);
});

test("Studio field request guards bind exact text script tags booleans duration and native creative enums to their actual field", () => {
  for (const [message, field, value] of [
    ['Mets le texte exact « Offre été » dans le Studio guidé.', "exactText", "Offre été"], ['Mets les mots-clés « Toiture », « Nantes » dans le Studio.', "textKeywords", ["Toiture", "Nantes"]], ['Mets le script fourni « Bonjour ! » dans le Studio libre.', "spokenScript", "Bonjour !"],
    ["Change le style du Studio en illustration.", "imageStyle", "illustration"], ["Mets deux personnes dans les critères du Studio.", "people", "two"], ["Mets le décor extérieur dans les critères Studio.", "setting", "exterior"], ["Choisis une voix féminine dans Studio.", "narrationVoice", "female"], ["Active la musique du Studio libre.", "withMusic", true], ["Désactive la musique du Studio libre.", "withMusic", false], ["Mets la durée à 8 secondes sur une seule scène dans Studio.", "durationScene", { seconds: 8, sceneMode: "single" }], ["Modifie la consigne du Studio.", "prompt", "Une formulation créative demandée"],
  ] as const) assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode(field, value)), true, message);
  for (const [message, field, value] of [
    ['Mets le texte exact « Offre été » dans Studio.', "exactText", "Faux texte"], ['Mets les mots-clés « Nantes » dans Studio.', "textKeywords", ["Paris"]], ["Active la musique dans Studio.", "withMusic", false], ["Choisis une voix féminine dans Studio.", "narrationVoice", "male"], ["Mets deux personnes dans Studio.", "people", "three"], ["Mets le style photo dans Studio.", "imageStyle", "three_d"], ["Mets 8 secondes dans Studio.", "durationScene", { seconds: 8, sceneMode: "single" }],
  ] as const) assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode(field, value)), false, message);
});

test("scheduled editor request guards bind current local CTA bytes and exact channel placement and Threads modes", () => {
  const guarded = (message: string, target: string, field: string, value: string) => isInrAssistantScheduledEditorValueRequested(message, target, encode(field, value));
  assert.equal(guarded("Dans le formulaire ouvert de la publication programmée, mets le lien https://exemple.fr/offre.", "scheduled_publication_text_form", "ctaUrl", "https://exemple.fr/offre"), true);
  assert.equal(guarded("Dans le formulaire ouvert de la publication programmée, mets le lien https://exemple.fr/offre.", "scheduled_publication_text_form", "ctaUrl", "https://invented.fr"), false);
  assert.equal(guarded("Dans le formulaire ouvert de la publication programmée, mets le téléphone 0601020304.", "scheduled_publication_text_form", "ctaPhone", "0700000000"), false);
  assert.equal(guarded("Dans le formulaire de la publication programmée, choisis le bouton devis.", "scheduled_publication_text_form", "ctaChoice", "appeler"), false);
  assert.equal(guarded("Dans le formulaire de la publication programmée, choisis le bouton devis.", "scheduled_publication_text_form", "ctaChoice", "devis"), true);
  for (const [word, expected] of [["Story", "story"], ["Reel", "reel"], ["Classique", "classic"], ["Reel et Story", "reel_story"], ["Classique et Story", "classic_story"]]) for (const value of ["story", "reel", "classic", "reel_story", "classic_story"]) assert.equal(guarded(`Dans l’éditeur ouvert de la publication programmée Facebook, mets le format ${word}.`, "scheduled_publication_options", "placement", value), value === expected);
  assert.equal(guarded("Dans l’éditeur de la publication programmée Threads, mets le mode Ghost.", "scheduled_publication_options", "threadsMode", "classic"), false);
  assert.equal(guarded("Dans l’éditeur de la publication programmée Threads, mets le mode Ghost.", "scheduled_publication_options", "threadsMode", "ghost"), true);
  assert.equal(guarded("Mets les préférences globales Threads par défaut en Ghost pour les publications programmées.", "scheduled_publication_options", "threadsMode", "ghost"), false);
  assert.equal(isInrAssistantScheduledEditorValueRequested("Choisis le canal Facebook de la publication programmée.", "scheduled_publication_channel", "instagram"), false);
  assert.equal(isInrAssistantScheduledEditorValueRequested("Dans le formulaire de la publication programmée, retouche cette image.", "scheduled_publication_media", "studio_generate"), false);
  assert.equal(isInrAssistantScheduledEditorValueRequested("Dans le formulaire de la publication programmée, retouche cette image.", "scheduled_publication_media", "studio_retouch"), true);
  assert.equal(isInrAssistantScheduledEditorValueRequested("Affiche la deuxième image de la publication programmée.", "scheduled_publication_media", "index:0"), false);
  assert.equal(isInrAssistantScheduledEditorValueRequested("Affiche la deuxième image de la publication programmée.", "scheduled_publication_media", "index:1"), true);
});

test("scheduled editor parsers retain native text limits and hidden CTA fields and refuse unavailable resource modes", () => {
  const draft = { channel: "facebook", title: "Titre", body: "Texte", hashtags: "", cta: "", ctaMode: "website", ctaUrl: "", ctaPhone: "", ctaAction: "" }, context = { enabled: true, open: true, busy: false, draft, ctaChoice: "site", ctaMode: "website", ctaChoices: ["site", "devis", "appeler"], websiteUrl: "https://site-enregistre.fr", supportsHashtags: true };
  assert.ok(parseInrAssistantScheduledTextSelection(encode("body", "\n".repeat(6000)), context)); assert.equal(parseInrAssistantScheduledTextSelection(encode("body", "a".repeat(6001)), context), null);
  for (const [field, value] of [["title", "a".repeat(181)], ["hashtags", "a".repeat(281)], ["cta", "a".repeat(181)], ["ctaPhone", "0601020304"], ["ctaUrl", "javascript:alert(1)"], ["saveAndPublish", "yes"], ["ctaChoice", "invented"]]) assert.equal(parseInrAssistantScheduledTextSelection(encode(field, value), context), null, field);
  assert.ok(parseInrAssistantScheduledTextSelection(encode("websiteChoice", "site_web"), context)); assert.equal(parseInrAssistantScheduledTextSelection(encode("websiteChoice", "inr_search"), context), null); assert.equal(parseInrAssistantScheduledTextSelection(encode("body", "x"), { ...context, enabled: false }), null);
  const options = { enabled: true, busy: false, channel: "facebook", placements: ["classic", "story"], storyEnabled: true, hasUsableMedia: true, threadsModes: ["classic"], pinterestBoardIds: ["real-board"] };
  assert.ok(parseInrAssistantScheduledOptionSelection(encode("placement", "story"), options)); assert.equal(parseInrAssistantScheduledOptionSelection(encode("placement", "reel"), options), null); assert.equal(parseInrAssistantScheduledOptionSelection(encode("placement", "classic_story"), { ...options, hasUsableMedia: false }), null); assert.equal(parseInrAssistantScheduledOptionSelection(encode("threadsMode", "ghost"), { ...options, channel: "threads" }), null); assert.equal(parseInrAssistantScheduledOptionSelection(encode("pinterestBoard", "invented"), { ...options, channel: "pinterest" }), null);
});
