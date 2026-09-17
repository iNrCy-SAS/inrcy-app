export type InrSearchStorageMediaCandidate = {
  bucket: string;
  storagePath: string;
};

export type InrSearchStorageObjectState = "exists" | "missing" | "unknown";

export type InrSearchStorageMediaResolverDependencies = {
  probeStorageObject: (
    bucket: string,
    storagePath: string,
  ) => Promise<InrSearchStorageObjectState>;
  getPublicUrl: (bucket: string, storagePath: string) => string | null;
  createSignedUrl: (
    bucket: string,
    storagePath: string,
  ) => Promise<string | null>;
};

async function resolveStorageMediaCandidate(
  candidate: InrSearchStorageMediaCandidate,
  dependencies: InrSearchStorageMediaResolverDependencies,
) {
  if (candidate.bucket === "booster") {
    // Supabase getPublicUrl only constructs a URL; it does not prove that the
    // object still exists. Keep the exact probe so deleted historical paths do
    // not become broken carousel slides.
    const objectState = await dependencies.probeStorageObject(
      candidate.bucket,
      candidate.storagePath,
    );
    if (objectState === "missing") return null;

    if (objectState === "exists") {
      const publicUrl = dependencies.getPublicUrl(
        candidate.bucket,
        candidate.storagePath,
      );
      if (publicUrl) return publicUrl;
    }
  }

  return dependencies.createSignedUrl(
    candidate.bucket,
    candidate.storagePath,
  );
}

export async function resolveInrSearchStorageMediaUrls(
  candidates: InrSearchStorageMediaCandidate[],
  dependencies: InrSearchStorageMediaResolverDependencies,
  limit = 5,
) {
  const resolvedCandidates = await Promise.all(
    candidates
      .slice(0, limit)
      .map((candidate) => resolveStorageMediaCandidate(candidate, dependencies)),
  );
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const resolvedUrl of resolvedCandidates) {
    if (!resolvedUrl || seen.has(resolvedUrl)) continue;
    seen.add(resolvedUrl);
    urls.push(resolvedUrl);
    if (urls.length >= limit) break;
  }
  return urls;
}
