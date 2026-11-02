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
  signAuthorizedUrl: (
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

  return dependencies.signAuthorizedUrl(
    candidate.bucket,
    candidate.storagePath,
  );
}

export async function resolveInrSearchStorageMediaUrl(
  candidates: InrSearchStorageMediaCandidate[],
  dependencies: InrSearchStorageMediaResolverDependencies,
) {
  for (const candidate of candidates) {
    const url = await resolveStorageMediaCandidate(candidate, dependencies);
    if (url) return url;
  }
  return null;
}

/** Only renew references already present in this account's published content. */
export async function resolveInrSearchHistoricalMediaUrls(
  urls: string[],
  dependencies: InrSearchStorageMediaResolverDependencies,
  scope: { supabaseUrl: string; accountId: string },
  limit = 5,
) {
  let storageOrigin = "";
  try { storageOrigin = new URL(scope.supabaseUrl).origin; } catch { /* No trusted origin to sign. */ }
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    let target: string | null = raw;

    if (url.origin === storageOrigin) {
      // Never fall back to the old token when an owned Storage reference is
      // missing or cannot be renewed. getPublicUrl alone cannot verify it.
      const match = url.pathname.match(
        /^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
      );
      if (!match) continue;
      let bucket: string;
      let storagePath: string;
      try {
        bucket = decodeURIComponent(match[1]);
        storagePath = decodeURIComponent(match[2]);
      } catch { continue; }
      const prefix = bucket === "booster"
        ? `${scope.accountId}/`
        : bucket === "inrcy-pro-media" ? `users/${scope.accountId}/` : "";
      if (!scope.accountId || !prefix || !storagePath.startsWith(prefix) ||
        storagePath.includes("\\") || storagePath.split("/").some((part) => !part || part === "." || part === "..")) continue;

      target = await resolveStorageMediaCandidate({ bucket, storagePath }, dependencies);
    }

    if (!target || seen.has(target)) continue;
    seen.add(target);
    resolved.push(target);
    if (resolved.length >= limit) break;
  }
  return resolved;
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
