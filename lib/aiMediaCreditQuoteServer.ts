import "server-only";
import { createHash } from "node:crypto";
import { quoteAiMediaCredits, type AiMediaCreditsQuoteInput } from "./aiMediaCreditsPricing.ts";
import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";
import { hasProvidedAiMediaCharacterVoice } from "./aiMediaCharacterVoices.ts";

export function createAiMediaServerQuote(accountId: string, input: AiMediaCreditsQuoteInput) {
  const quote = quoteAiMediaCredits(input);
  // Image format and the fixed provider canvas are part of the quote identity,
  // even when a bounded model has the same commercial price in every format.
  const quoteId = createHash("sha256").update(JSON.stringify({ accountId, ...quote })).digest("hex");
  return { ...quote, quoteId };
}

export function quoteAiMediaRequest(accountId: string, request: AiMediaGenerationRequest) {
  return createAiMediaServerQuote(accountId, {
    ...request,
    inspirationImagesCount: request.inspirationImages.length,
    hasProvidedCharacterVoice: hasProvidedAiMediaCharacterVoice(request.inspirationImages),
  });
}

export function assertAiMediaCreditQuote(request: AiMediaGenerationRequest, quote: ReturnType<typeof createAiMediaServerQuote>) {
  return request.expectedCredits === quote.totalCredits &&
    request.creditTariffVersion === quote.tariffVersion && request.creditQuoteId === quote.quoteId;
}
