import { buildAiMediaImageGenerationPrompt } from "@/lib/aiMediaImageGenerationPrompt";
import { buildAiMediaModificationPrompt } from "@/lib/aiMediaModificationPrompt";
import { buildAiMediaVideoGenerationPrompt } from "@/lib/aiMediaVideoGenerationPrompt";
import type { AiMediaPromptBuilderArgs } from "@/lib/aiMediaPromptShared";
import { buildAiMediaFreeImagePrompt, buildAiMediaFreeVideoPrompt } from "@/lib/aiMediaFreeGenerationPrompt";

export {
  AI_MEDIA_COMPILED_PROMPT_MAX_CHARS,
  AI_MEDIA_PROMPT_VERSION,
  getAiMediaIdentityDirection,
  getAiMediaImageQualityBar,
  getAiMediaRenderDirection,
  getAiMediaVisualDirection,
} from "@/lib/aiMediaPromptShared";
export { getAiMediaPromptOutputSpec } from "@/lib/aiMediaPromptOutputSpec";

/**
 * Routeur public du Studio. Chaque parcours possède son propre contrat moteur ;
 * aucune règle créative n'est assemblée dans ce point d'entrée.
 */
export function buildAiMediaPrompt(args: AiMediaPromptBuilderArgs) {
  if (args.request.operation === "modify") {
    return buildAiMediaModificationPrompt(args.request);
  }
  if (args.request.creationMode === "free") {
    return args.request.kind === "video"
      ? buildAiMediaFreeVideoPrompt(args)
      : buildAiMediaFreeImagePrompt(args);
  }
  if (args.request.kind === "video") {
    return buildAiMediaVideoGenerationPrompt(args);
  }
  return buildAiMediaImageGenerationPrompt(args);
}
