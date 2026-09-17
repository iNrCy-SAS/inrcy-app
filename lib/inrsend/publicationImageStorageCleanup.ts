type StorageCleanupError = {
  message?: string | null;
} | null;

export type PublicationImageStorageCleanupClient = {
  storage: {
    from: (bucket: string) => {
      remove: (
        paths: string[],
      ) => Promise<{ error: StorageCleanupError }>;
    };
  };
};

export type PublicationImageStorageCleanupResult = {
  attemptedPaths: string[];
  error: string | null;
};

export type PublicationImageUseGuard = {
  markAssetsMayBeInUse: () => void;
  canCleanupUnusedAssets: () => boolean;
};

/**
 * Once an external write starts, its outcome can be ambiguous even when the
 * caller receives an error. The guard is intentionally irreversible so a
 * timeout can never cause media already referenced remotely to be deleted.
 */
export function createPublicationImageUseGuard(): PublicationImageUseGuard {
  let assetsMayBeInUse = false;
  return {
    markAssetsMayBeInUse: () => {
      assetsMayBeInUse = true;
    },
    canCleanupUnusedAssets: () => !assetsMayBeInUse,
  };
}

function cleanupErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "").trim();
  }
  return String(error || "").trim();
}

/**
 * Removes only paths explicitly created by the current edit attempt.
 * Cleanup is intentionally best effort so it never hides the publication
 * error that triggered it.
 */
export async function removeCreatedPublicationImagePathsBestEffort(params: {
  client: PublicationImageStorageCleanupClient;
  paths: readonly unknown[];
  bucket?: string;
}): Promise<PublicationImageStorageCleanupResult> {
  const attemptedPaths = Array.from(
    new Set(
      params.paths
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!attemptedPaths.length) {
    return { attemptedPaths, error: null };
  }

  try {
    const result = await params.client.storage
      .from(params.bucket || "booster")
      .remove(attemptedPaths);
    return {
      attemptedPaths,
      error: result.error ? cleanupErrorMessage(result.error) || "storage_cleanup_failed" : null,
    };
  } catch (error) {
    return {
      attemptedPaths,
      error: cleanupErrorMessage(error) || "storage_cleanup_failed",
    };
  }
}
