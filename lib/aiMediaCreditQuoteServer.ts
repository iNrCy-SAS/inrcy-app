import "server-only";
import { createHash } from "node:crypto";
import { quoteAiMediaCredits, type AiMediaCreditsQuoteInput } from "./aiMediaCreditsPricing.ts";
import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";

export function createAiMediaServerQuote(accountId: string, input: AiMediaCreditsQuoteInput) {
  const quote = quoteAiMediaCredits(input);
  const quoteId = createHash("sha256").update(JSON.stringify({ accountId, ...quote })).digest("hex");
  return { ...quote, quoteId };
}

export function quoteAiMediaRequest(accountId: string, request: AiMediaGenerationRequest) {
  return createAiMediaServerQuote(accountId, {
    ...request,
    inspirationImagesCount: request.inspirationImages.length,
  });
}

export function assertAiMediaCreditQuote(request: AiMediaGenerationRequest, quote: ReturnType<typeof createAiMediaServerQuote>) {
  return request.expectedCredits === quote.totalCredits &&
    request.creditTariffVersion === quote.tariffVersion && request.creditQuoteId === quote.quoteId;
}
