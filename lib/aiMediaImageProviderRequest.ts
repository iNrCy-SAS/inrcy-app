import type {
  AiMediaIdentityMode,
  AiMediaInspirationImage,
  AiMediaOperation,
} from "@/lib/aiMediaGenerationContracts";

export type AiMediaImageProviderRequest = {
  accountId: string;
  prompt: string;
  operation?: AiMediaOperation;
  identityMode: AiMediaIdentityMode;
  identityReferences?: readonly Buffer[];
  referenceRoles?: ReadonlyArray<
    Pick<AiMediaInspirationImage, "role" | "usage" | "characterIndex">
  >;
  officialLogo?: Buffer | null;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  signal?: AbortSignal;
};

/**
 * Contrat immuable partagé par le moteur image nominal et son fallback.
 * Le prompt Studio compilé ne peut donc pas être réduit lors du reroutage.
 */
export function buildAiMediaImageProviderRequest(
  args: AiMediaImageProviderRequest,
): Readonly<AiMediaImageProviderRequest> {
  if (!args.prompt.trim()) throw new Error("ai_image_provider_prompt_empty");
  return Object.freeze({ ...args });
}
