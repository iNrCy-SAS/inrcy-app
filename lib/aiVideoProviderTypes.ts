import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";

export type AiVideoProviderClip = {
  buffer: Buffer;
  mediaType: string;
  durationSeconds: 4 | 6 | 8;
  requestId: string;
};

export type AiVideoProviderResult = {
  provider: string;
  model: string;
  clips: AiVideoProviderClip[];
  estimatedCostMicroUsd: number;
  warnings: string[];
};

export type AiVideoProviderGenerationArgs = {
  accountId: string;
  request: AiMediaGenerationRequest;
  plan: AiMediaCreativePlan;
  creativeBrief: string;
  brandColors: readonly string[];
  profession: string;
  /**
   * Best-effort cancellation propagated from the browser request. Veo does not
   * expose an operation-cancel method in the Gemini Developer API SDK, but the
   * signal still stops submission, polling and download as early as possible.
   */
  signal?: AbortSignal;
};

export interface AiVideoProvider {
  readonly id: string;
  readonly model: string;
  generate(args: AiVideoProviderGenerationArgs): Promise<AiVideoProviderResult>;
}
