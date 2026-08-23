import { normalizeStorageDeliveryUrl } from "@/lib/storageUrlSanitization";

type SignedUploadResponse = {
  data: { token: string; signedUrl: string } | null;
  error: { message?: string; statusCode?: number | string } | null;
};

function isTransientStorageError(error: SignedUploadResponse["error"]) {
  const status = Number(error?.statusCode);
  const message = String(error?.message || "").toLowerCase();
  return (
    (Number.isFinite(status) && status >= 500) ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("gateway") ||
    message.includes("temporarily unavailable")
  );
}

/** Retries only transient Storage gateway/network failures before surfacing the error. */
export async function createSignedUploadUrlWithRetry(
  create: () => Promise<SignedUploadResponse>,
) {
  let lastResult: SignedUploadResponse | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await create();
      const normalizedResult = result.data
        ? {
            ...result,
            data: {
              ...result.data,
              signedUrl: normalizeStorageDeliveryUrl(result.data.signedUrl),
            },
          }
        : result;
      lastResult = normalizedResult;
      if (!result.error || !isTransientStorageError(result.error) || attempt === 2) {
        return normalizedResult;
      }
    } catch (error) {
      const normalized: SignedUploadResponse = {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
      lastResult = normalized;
      if (!isTransientStorageError(normalized.error) || attempt === 2) return normalized;
    }

    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }

  return lastResult || { data: null, error: { message: "Storage upload URL unavailable" } };
}
