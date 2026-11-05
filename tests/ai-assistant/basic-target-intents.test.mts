import assert from "node:assert/strict";
import test from "node:test";
import { isInrAssistantDnaScheduleRequest as dna, isInrAssistantPinterestBoardRequest as pinterest, isInrAssistantSocialPreferencesRequest as social, isInrAssistantWebsiteLifecycleRequest as site, isInrAssistantBusinessIdentityRequest as identity, isInrAssistantNativePresentationRequest as presentation, isInrAssistantWebsiteConfigurationRequest as website } from "../../lib/inrAssistantBasicTargetIntents.ts";
import { inrAssistantRequiredTools } from "../../lib/inrAssistantTaskPolicy.ts";
test("ADN schedule intent binds programming to the analysis itself, never to content using ADN", () => {
  for (const quote of ["Programme l’analyse mensuelle ADN le 6 à 08:30.", "Désactive la programmation mensuelle de mon ADN.", "Change la programmation de l’analyse ADN.", "Active l’analyse automatique ADN.", "Crée une image puis programme l’analyse ADN le 5 à 9h."]) assert.equal(dna(quote), true, quote);
  for (const quote of ["Programme une publication Facebook à 9h à partir de mon ADN.", "Crée une image pour notre offre toiture puis prépare et programme une publication Facebook pour demain à neuf heures, à partir de mon ADN.", "Modifie mon analyse ADN.", "Programme l’analyse de cette publication à partir de mon ADN.", "Lis mon ADN puis programme une publication.", "Comment programmer l’analyse ADN ?", "Ne programme pas l’analyse ADN.", "Le texte dit « Programme l’analyse mensuelle ADN »."]) assert.equal(dna(quote), false, quote);
  assert.equal(dna("Lis mon ADN puis programme une publication.", "programme une publication."), false);
});
test("Pinterest board intent requires a board as the direct action object and accepts quoted names", () => {
  for (const quote of ["Crée un tableau Pinterest nommé « Jardin ».", 'Crée un tableau Pinterest nommé "Jardin".', "Crée une image puis crée le tableau Pinterest Jardin.", "Peux-tu créer un tableau Pinterest nommé « Jardin » ?"]) assert.equal(pinterest(quote, "create"), true, quote);
  assert.equal(pinterest("Renomme le tableau Catalogue de Pinterest en Jardin.", "rename"), true); assert.equal(pinterest("Supprime le tableau Catalogue de Pinterest.", "delete"), true);
  for (const quote of ["Crée une publication Pinterest dans le tableau Jardin.", "Crée une image pour le tableau Pinterest Jardin.", "Comment créer un tableau Pinterest ?", "Peux-tu m’expliquer comment créer un tableau Pinterest ?", "Le texte dit « Crée un tableau Pinterest nommé Jardin »." ]) assert.equal(pinterest(quote, "create"), false, quote);
  assert.equal(pinterest("Le message du client demande : crée un tableau Pinterest Jardin.", "create", "crée un tableau Pinterest Jardin."), false);
});
test("global social defaults remain distinct from the format of a selected publication", () => {
  for (const [quote, channel] of [["Désactive les Reels Facebook.", "facebook"], ["Active les Stories Instagram.", "instagram"], ["Mets le mode Threads « ghost » par défaut.", "threads"], ["Modifie les préférences globales de formats Threads.", "threads"]] as const) assert.equal(social(quote, channel), true, quote);
  for (const quote of ["Modifie cette publication Threads en mode ghost.", "Mets cette publication Threads en mode ghost.", "Active le mode Ghost sur cette publication Threads.", "Modifie le format de la publication Threads en Ghost.", "Comment modifier les préférences Threads ?", "Le texte dit « Active les Ghost de Threads »." ]) assert.equal(social(quote, "threads"), false, quote);
});
test("Site Web lifecycle intent cannot be borrowed from a photo, widget or Google binding", () => {
  for (const quote of ["Supprime le lien de mon Site Web.", "Déconnecte mon Site Web.", "Supprime l’URL du Site Web."]) assert.equal(site(quote, "remove_url"), true, quote);
  for (const quote of ["Réinitialise mon Site Web.", "Réinitialise la configuration de mon Site Web.", "Réinitialise toute la configuration du Site Web."]) assert.equal(site(quote, "reset"), true, quote);
  for (const quote of ["Supprime la photo de mon site web.", "Supprime le lien de la photo de mon site web.", "Déconnecte Google Analytics de mon site web.", "Comment supprimer le lien du Site Web ?", "Le texte dit « Supprime le lien du Site Web »." ]) assert.equal(site(quote, "remove_url"), false, quote);
  for (const quote of ["Réinitialise la photo de mon Site Web.", "Réinitialise la configuration du widget de mon Site Web.", "Réinitialise Google Analytics de mon Site Web."]) assert.equal(site(quote, "reset"), false, quote);
});
test("identity, presentation and website settings cannot steal a media or publication object", () => {
  const cases = [["Modifie cette image pour mon Badge avec des couleurs vertes.", "updateNativeChannelPresentation"], ["Modifie cette image du widget de mon site web.", "updateWebsiteConfiguration"], ["Modifie cette image pour montrer mon métier de plombier.", "updateBusinessIdentity"], ["Modifie le texte de ma publication Facebook pour annoncer nos actualités.", "updateWebsiteConfiguration"]];
  for (const [quote, wrongTool] of cases) assert.equal(inrAssistantRequiredTools(quote).includes(wrongTool), false, quote);
  assert.equal(presentation(cases[0][0], "inrbadge"), false); assert.equal(website(cases[1][0], "widget"), false); assert.equal(identity(cases[2][0]), false);
  assert.equal(identity("Peux-tu modifier le nom de mon entreprise en « Atelier Bleu » ?"), true);
  assert.equal(presentation("Peux-tu modifier le thème de mon Badge en « forest » ?", "inrbadge"), true);
  assert.equal(website("Peux-tu modifier la disposition du widget en « grid » ?", "widget"), true);
  assert.equal(website("Rattache GA4 avec G-TEST123456 et la propriété 123456789.", "analytics"), true);
});
