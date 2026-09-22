import {
  AI_MEDIA_FORMAT_SPECS,
  AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS,
  type AiMediaGenerationRequest,
} from "@/lib/aiMediaGenerationContracts";
import {
  AI_MEDIA_PROMPT_VERSION,
  cleanAiMediaPromptStructuredText,
  fitCompiledAiMediaPrompt,
} from "@/lib/aiMediaPromptShared";

/** Contrat propriétaire de Modifier · Image. Aucune logique Générer n'intervient. */
export function buildAiMediaModificationPrompt(
  request: AiMediaGenerationRequest
) {
  const format = AI_MEDIA_FORMAT_SPECS[request.format];
  const sourceWidth = request.modificationSourceWidth || format.width;
  const sourceHeight = request.modificationSourceHeight || format.height;
  const sourceRatio = (sourceWidth / sourceHeight)
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const instruction = cleanAiMediaPromptStructuredText(
    request.aiInstruction,
    AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS + 1
  );
  if (instruction.length > AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS) {
    throw new Error("ai_media_modification_instruction_too_long");
  }
  return fitCompiledAiMediaPrompt(
    [
      `Version : ${AI_MEDIA_PROMPT_VERSION}.`,
      "CONTRAT MODIFIER IMAGE — il ne s’agit pas de créer une nouvelle scène : la mission exclusive consiste à transformer localement le fichier source fourni.",
      "L’unique image fournie est l’IMAGE SOURCE et le canvas de départ obligatoire. Produire une version modifiée de cette même image, jamais une inspiration libre, une réinterprétation ou une scène de remplacement.",
      `CANVAS SOURCE AUTORITAIRE : ${sourceWidth} × ${sourceHeight} px, ratio exact ${sourceWidth}:${sourceHeight} (≈ ${sourceRatio}:1). Conserver strictement ces proportions, le cadrage et les limites visibles de l’image source. Ne jamais convertir ce canvas vers un preset 1:1, 4:5, 9:16, 16:9 ou 3:2.`,
      `CONSIGNE UNIQUE À APPLIQUER : ${instruction}`,
      "Modifier uniquement les zones et éléments nécessaires pour exécuter cette consigne. Conserver tout le reste : sujet, identité, objets, composition, cadrage, perspective, proportions, lumière, couleurs et détails non visés.",
      "Si la consigne remplace ou supprime un élément, reconstruire proprement la zone concernée tout en préservant la continuité visuelle avec l’image source.",
      "En cas d’ambiguïté, choisir la modification la plus locale et la plus minimale. N’ajouter aucun élément, texte, logo, personne ou décor qui n’est pas explicitement demandé.",
      "TEXTE EN MODE MODIFICATION : conserver mot pour mot tout texte non visé. Si la consigne demande explicitement d’ajouter, remplacer ou supprimer des mots, nombres ou coordonnées, exécuter cette correction locale avec les valeurs exactes fournies, sans slogan supplémentaire ni reformulation. Ne jamais afficher la consigne technique elle-même.",
      "SORTIE : une seule image finale plein cadre aux proportions exactes de la source, sans bordure, marge blanche ou noire, letterbox, pillarbox, planche comparative, avant/après, cadre, légende ni explication.",
      "CONTRÔLE FINAL SILENCIEUX : la modification demandée est clairement visible et tous les éléments non concernés restent fidèles à la source.",
      "SÉCURITÉ ET FAITS : ne jamais inventer de prix, promotion, certification, avis client, adresse, téléphone ou résultat garanti absent de la source et de la consigne. Respecter les droits ; ne pas imiter une personnalité publique non autorisée, une œuvre ou un personnage protégé.",
    ].join("\n\n")
  );
}
