import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, AI_MEDIA_IMAGE_MODELS, AI_MEDIA_VIDEO_MODELS, getAiMediaVideoDurations } from "./aiMediaModelCatalog.ts";
import { AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS, AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS, AI_MEDIA_NARRATION_VOICE_MIN_SECONDS, isAiMediaCharacterVoiceEngine } from "./aiMediaCharacterVoices.ts";

function videoCatalogueRange(model: typeof AI_MEDIA_AVAILABLE_VIDEO_MODELS[number]): string {
  const durations = [...new Set(model.resolutions.flatMap(resolution => ["single", "multi"].flatMap(mode => getAiMediaVideoDurations(model.id, resolution, mode as "single" | "multi"))))].filter(seconds => seconds >= 4 && seconds <= 30).sort((a, b) => a - b);
  return `${durations[0]}–${durations.at(-1)} s`;
}

/** Deliberately narrow public FAQ. Unknown words, account/file questions and a
 * second order stay with the normal planner; this function never executes tools. */
export function verifiedInrAssistantStudioCatalogueAnswer(message: string): string | null {
  if (message.length > 1_400 || /[«»“”"`]|https?:\/\/|@/.test(message)) return null;
  let text = message.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase();
  text = text
    .replace(/\bsans\s+(?:rien\s+)?(?:creer|generer|lancer)(?:\s+de)?\s+(?:medias?|videos?|generation)\b/g, " ")
    .replace(/\bne\s+(?:lance|genere)\s+(?:rien|pas)\b/g, " ")
    .replace(/\bne\s+modifie\s+pas\s+(?:mes|les)\s+preferences\b/g, " ")
    .replace(/\bpas\s+de\s+videos?\b|\baucune\s+generation\b/g, " ");
  if (/\b\d+\s*(?:s|secondes?|minutes?|euros?|credits?)\b/.test(text)) return null;
  const vocabulary = new Set(("a ai affiche affiches alternatives alternative actuellement actifs actives actif active ajouter animer animation avec catalogue ce ces cet cette chez clip clips comment compatibilite compatibles compatible comparer compare compares comparaison contraintes dans d de des distinct distincte distinctes distincts disponible disponibles donne donnez duree durees du echantillon echantillons en encore entre est et etre faire fourni fournie fournis fournies francais il ils image images inrcy inrstudio ia je la le les lesquels leur leurs limite limites l liste lister m ma mais maximale maximales maximum me media medias mes min minimale minimales minimum modele modeles moi mon moteurs moteur n ne nouvelle nouvelles nouveau nouveaux ni on options ou parcours par parler partir pas personnage personnages peut peuvent photo photos plus pour propre propres propose proposee proposees proposes quelle quelles quel quels que qui r2v reference references reel reelle reelles reels resolution resolutions retire retiree retirees retires rien s se seconde secondes selon ses sont studio sur timbre tout toutes tous tu un une uniquement veux video videos vocal vocale vocales vocaux voix votre".split(/\s+/)));
  for (const model of [...AI_MEDIA_VIDEO_MODELS, ...AI_MEDIA_IMAGE_MODELS]) for (const token of model.label.toLowerCase().match(/[a-z0-9]+/g) ?? []) vocabulary.add(token);
  if ((text.match(/[a-z0-9]+/g) ?? []).some(token => !vocabulary.has(token))) return null;
  const voice = /\b(?:moteurs?|modeles?)\b/.test(text) && /\b(?:photo|photos|personnage|personnages)\b/.test(text) && /\b(?:vocal|vocaux|voix)\b/.test(text);
  const image = /\b(?:moteurs?|modeles?)\b/.test(text) && /\bimages?\b/.test(text)
    && /\b(?:disponibles?|propose\w*|catalogue|compare\w*|comparaison)\b/.test(text)
    && !/\b(?:videos?|voix|vocal|vocaux|personnages?)\b/.test(text);
  const retired = AI_MEDIA_VIDEO_MODELS.filter(model => !AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(available => available.id === model.id));
  const retiredQuestion = /\b(?:encore|propose\w*|retir\w*|alternatives?)\b/.test(text)
    && retired.some(model => text.includes(model.label.toLowerCase()));
  if (!voice && !retiredQuestion && !image) return null;
  if (image) return [
    "Voici les moteurs d’image actuellement proposés dans iNr’Studio. Le parcours produit des images raster :",
    ...AI_MEDIA_IMAGE_MODELS.map(model => `**${model.label}** : ${model.description} Références : ${model.supportsReferences ? `jusqu’à ${model.maxReferenceImages} images` : "non prises en charge"}. Retouche : ${model.supportsModify ? "prise en charge" : "non prise en charge"}.`),
    "Ces caractéristiques décrivent le parcours disponible ; elles ne constituent pas un classement de qualité. Aucune génération n’a été lancée.",
  ].join("\n\n");
  const provided = AI_MEDIA_AVAILABLE_VIDEO_MODELS.filter(model => isAiMediaCharacterVoiceEngine(model.id));
  const voiceLines = provided.map(model => `${model.label} : échantillon vocal fourni de ${model.id === "kling" ? AI_MEDIA_NARRATION_VOICE_MIN_SECONDS : AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS} à ${AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS} secondes ; vidéo de ${videoCatalogueRange(model)} ; ${model.resolutions.join("/")}.`);
  const voiceNotes = [
    "Le vocal réel fourni est facultatif pour une génération ordinaire. Il devient nécessaire si vous choisissez ce mode : sa durée et celle du clip sont distinctes. Un minimum de cinq secondes chez Kling ne s’applique pas à Wan. Un clip peut dépasser l’échantillon ; aucune boucle ou troncature n’est déduite de ces durées.",
    "Parcours : Studio → Voix → Ajouter un vocal → Importer, Enregistrer ou Médiathèque, puis affecter le vocal au personnage. Confirmez personnellement vos droits sur la voix. Le timbre de référence et les paroles à prononcer sont distincts ; la voix off dispose d’un parcours séparé sans personnage imposé.",
  ];
  if (voice && !retiredQuestion) return ["Pour faire parler un personnage à partir d’une photo avec votre propre vocal, les moteurs actuellement proposés compatibles sont :", ...voiceLines, ...voiceNotes].join("\n\n");
  const rows = AI_MEDIA_AVAILABLE_VIDEO_MODELS.map(model => `| ${model.label} | ${videoCatalogueRange(model)} | ${model.resolutions.join("/")} | ${model.supportsTextToVideo ? "Oui" : "Image requise"} | ${isAiMediaCharacterVoiceEngine(model.id) ? "Oui, facultatif" : "Non dans ce parcours"} |`);
  return [
    `${retired.map(model => model.label).join(", ")} ne sont plus proposés pour une nouvelle génération. Les anciens résultats restent consultables ; aucun moteur de remplacement n’est sélectionné automatiquement.`,
    "Alternatives actuellement proposées, sans classement de qualité :\n| Moteur | Durée du clip | Résolutions | Texte seul | Vocal réel fourni |\n|---|---|---|---|---|\n" + rows.join("\n"),
    "Les durées exactes dépendent de la qualité et du mode de plans choisis. Kling Flash et Kling Omni, ainsi que Wan 2.6 et Wan 2.7, sont des modèles distincts : leurs limites ne s’échangent pas.",
    ...voiceLines, ...voiceNotes,
    "Le devis natif vérifiera les crédits et les options avant une éventuelle génération. Cette réponse ne change aucun réglage.",
  ].join("\n\n");
}

/** Public native catalogue, never provider credentials, prices or a promise of availability. */
export function inrAssistantStudioFacts(query: string, maxChars = 1_600): string {
  const text = query.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!/studio|moteurs?|models?|modeles?|voix|vocal|voice|image|video|kling|\bwan\b|veo|minimax|heygen/.test(text)) return "";
  if (!/moteurs?|models?|modeles?|compatib|voix|vocal|voice|lip.?sync|options?|choix|possibil|alternativ|retir|disponib|duree|secondes?/.test(text)) return "";
  const provided = AI_MEDIA_AVAILABLE_VIDEO_MODELS.filter(model => isAiMediaCharacterVoiceEngine(model.id));
  const videoRange = videoCatalogueRange;
  const videos = AI_MEDIA_AVAILABLE_VIDEO_MODELS.map(model => `${model.label} (${videoRange(model)} ; ${model.resolutions.join("/")})`);
  const retired = AI_MEDIA_VIDEO_MODELS.filter(model => !AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(available => available.id === model.id));
  const voiceQuestion = /voix|vocal|voice|lip.?sync/.test(text);
  const positiveMediaText = text.replace(/\b(?:pas de|aucune?|sans|no)\s+videos?\b/g, " ");
  const imageOnly = /image|photo|visuel/.test(text) && !/video|voix|vocal|voice|personnage/.test(positiveMediaText);
  const kling = AI_MEDIA_AVAILABLE_VIDEO_MODELS.find(model => model.id === "kling");
  const voiceEngines = `Vocal réel fourni OPTIONNEL : ${provided.map(model => model.label).join(" ou ")}. L’échantillon est obligatoire seulement si ce mode est choisi. Wan : ${AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS} à ${AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS} s, minimum Kling non applicable.`;
  const voiceConstraint = `Kling : si le mode vocal réel fourni est choisi, vocal parlé de ${AI_MEDIA_NARRATION_VOICE_MIN_SECONDS} à ${AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS} secondes OBLIGATOIRE ; plus court refusé. ${kling ? `Durée de la vidéo : ${videoRange(kling)}, distincte de l’échantillon vocal. Le minimum5s du vocal ne relève pas le minimum4s du clip ; le clip peut dépasser le vocal, sans règle de boucle/troncature déduite.` : ""}`;
  const voicePath = "Voix : Studio → Voix → Ajouter un vocal → Importer/Enregistrer/Médiathèque. Affecter au personnage ; droits confirmés personnellement. Le vocal caractérise le timbre, les paroles exactes restent distinctes. Voix off : parcours séparé, voix IA ou vocal réel fourni avec consentement personnel, sans personnage imposé.";
  const retiredLine = `Vidéos retirées et indisponibles pour générer : ${retired.map(model => model.label).join(", ")}.`;
  const videoLine = `Vidéos proposées : ${videos.join(", ")}. Modèles distincts : ne pas attribuer à Flash les limites Omni. Durées selon qualité/plans ; aucun classement ou plafond de locuteurs déduit.`;
  const lines = [
    "Studio : catalogue natif ; devis/crédits avant génération.",
    ...(imageOnly ? ["Image : proposer seulement les moteurs d’image, aucun moteur vidéo."] : voiceQuestion ? [voiceConstraint, voiceEngines, retiredLine, voicePath, videoLine] : [retiredLine, videoLine, voiceConstraint, voiceEngines, voicePath]),
    `Images : ${AI_MEDIA_IMAGE_MODELS.map(model => model.label).join(", ")}.`,
    "Nommer les contrôles visibles et proposer l’aide ou le prompt éditable ; ne demander aucun ID ni champ technique au professionnel. Pour une demande de prompt seule, proposer l’insertion, sans lancer une génération.",
  ];
  const result: string[] = [];
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 1_600;
  for (const line of lines) {
    if ([...result, line].join("\n").length <= limit) result.push(line);
    else if (line === videoLine) {
      // Abbreviated context must not imply these are the only offered models.
      const sent: string[] = [];
      for (const video of videos) {
        const partial = `Vidéos proposées (liste partielle, autres moteurs à consulter dans Studio) : ${[...sent, video].join(", ")}.`;
        if ([...result, partial].join("\n").length <= limit) sent.push(video);
      }
      if (sent.length) result.push(`Vidéos proposées (liste partielle, autres moteurs à consulter dans Studio) : ${sent.join(", ")}.`);
    }
  }
  return result.join("\n");
}
