/**
 * Removes transport artefacts that can be appended to a Supabase signed URL
 * when a value crosses a Windows/native bridge. A Supabase JWT is base64url,
 * so a literal or percent-encoded trailing backslash can never be part of a
 * valid signature.
 */
export function normalizeStorageDeliveryUrl(value: unknown): string {
  let normalized = String(value ?? "").trim();
  if (!normalized) return "";

  // Run twice to cover mixed endings such as "\\%5C" without touching an
  // encoded backslash that appears anywhere else in the URL.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = normalized.replace(/(?:\\|%5c)+$/i, "").trim();
    if (next === normalized) break;
    normalized = next;
  }

  return normalized;
}

/**
 * Supabase signed-object endpoints reject HEAD on some storage versions. The
 * two iNrCy delivery routes redirect to the same endpoint, so they must also
 * be probed with a bounded one-byte GET.
 */
export function shouldUseRangeGetForStorageDeliveryUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    const path = url.pathname.replace(/\/+$/, "");
    return (
      path.includes("/storage/v1/object/sign/") ||
      path === "/api/storage/content" ||
      /^\/api\/media-library\/items\/[^/]+\/content$/i.test(path)
    );
  } catch {
    return false;
  }
}
