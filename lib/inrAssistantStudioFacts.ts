import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, AI_MEDIA_IMAGE_MODELS, AI_MEDIA_VIDEO_MODELS, getAiMediaVideoDurations } from "./aiMediaModelCatalog.ts";
import { AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS, AI_MEDIA_NARRATION_VOICE_MIN_SECONDS, isAiMediaCharacterVoiceEngine } from "./aiMediaCharacterVoices.ts";

/** Public native catalogue, never provider credentials, prices or a promise of availability. */
export function inrAssistantStudioFacts(query: string, maxChars = 1_600): string {
  const text = query.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!/studio|moteurs?|models?|modeles?|voix|vocal|voice|image|video|kling|\bwan\b|veo|minimax|heygen/.test(text)) return "";
  if (!/moteurs?|models?|modeles?|compatib|voix|vocal|voice|lip.?sync|options?|choix|possibil|alternativ|retir|disponib|duree|secondes?/.test(text)) return "";
  const provided = AI_MEDIA_AVAILABLE_VIDEO_MODELS.filter(model => isAiMediaCharacterVoiceEngine(model.id));
  const videoRange = (model: typeof AI_MEDIA_AVAILABLE_VIDEO_MODELS[number]) => {
    const durations = [...new Set(model.resolutions.flatMap(resolution => ["single", "multi"].flatMap(mode => getAiMediaVideoDurations(model.id, resolution, mode as "single" | "multi"))))].filter(seconds => seconds >= 4 && seconds <= 30).sort((a, b) => a - b);
    return `${durations[0]}–${durations.at(-1)} s`;
  };
  const videos = AI_MEDIA_AVAILABLE_VIDEO_MODELS.map(model => `${model.label} (${videoRange(model)} ; ${model.resolutions.join("/")})`);
  const retired = AI_MEDIA_VIDEO_MODELS.filter(model => !AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(available => available.id === model.id));
  const voiceQuestion = /voix|vocal|voice|lip.?sync/.test(text);
  const positiveMediaText = text.replace(/\b(?:pas de|aucune?|sans|no)\s+videos?\b/g, " ");
  const imageOnly = /image|photo|visuel/.test(text) && !/video|voix|vocal|voice|personnage/.test(positiveMediaText);
  const kling = AI_MEDIA_AVAILABLE_VIDEO_MODELS.find(model => model.id === "kling");
  const voiceEngines = `Vocal réel fourni OPTIONNEL : ${provided.map(model => model.label).join(" ou ")}. L’échantillon est obligatoire seulement si ce mode est choisi. Ne pas inventer le développement de R2V.`;
  const voiceConstraint = `Kling : vocal parlé de ${AI_MEDIA_NARRATION_VOICE_MIN_SECONDS} à ${AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS} secondes OBLIGATOIRE ; plus court refusé, pas un essai à lancer. ${kling ? `Durée de la vidéo : ${videoRange(kling)}, distincte de l’échantillon vocal. Le minimum5s du vocal ne relève pas le minimum4s du clip ; le clip peut dépasser le vocal, sans règle de boucle/troncature déduite.` : ""}`;
  const voicePath = "Voix : Studio → Voix → Ajouter un vocal → Importer/Enregistrer/Médiathèque. Affecter au personnage ; droits confirmés personnellement. Le vocal caractérise le timbre, les paroles exactes restent distinctes. Voix off : parcours séparé, voix IA ou vocal réel fourni avec consentement personnel, sans personnage imposé.";
  const retiredLine = `Vidéos retirées et indisponibles pour générer : ${retired.map(model => model.label).join(", ")}.`;
  const videoLine = `Vidéos proposées : ${videos.join(", ")}. Modèles distincts : ne pas attribuer à Flash les limites Omni. Durées selon qualité/plans ; aucun classement ou plafond de locuteurs déduit.`;
  const lines = [
    "Studio : catalogue et contraintes natifs prioritaires ; devis/crédits vérifiés avant génération.",
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
