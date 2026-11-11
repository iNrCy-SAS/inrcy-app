import { buildMetaGraphUrl } from "@/lib/metaGraphApi";

export class FacebookPostDeleteError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly providerCode?: number) {
    super(message);
    this.name = "FacebookPostDeleteError";
  }
}

/** Keep video IDs intact; only resolve a rejected singular-status ID on its own Page. */
export async function deleteFacebookPost(postId: string, pageAccessToken: string, pageId: string) {
  if (!postId) return;
  const candidates = [postId];
  for (const candidate of candidates) {
    const response = await fetch(buildMetaGraphUrl(encodeURIComponent(candidate)), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${pageAccessToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && (payload === true || payload?.success === true)) return;

    const providerCode = Number(payload?.error?.code) || undefined;
    const message = String(payload?.error?.message || `Suppression Facebook non confirmée (${response.status}).`);
    // Meta has explicitly refused this ID, so this retry cannot delete twice.
    // Never retry permissions, rate limits, timeouts, or an unacknowledged success.
    if (!response.ok && candidate === postId && candidates.length === 1 &&
        providerCode === 12 && /singular statuses API is deprecated/i.test(message) &&
        /^\d+$/.test(postId) && /^\d+$/.test(pageId)) {
      candidates.push(`${pageId}_${postId}`);
      continue;
    }
    throw new FacebookPostDeleteError(message, response.status, providerCode);
  }
}
