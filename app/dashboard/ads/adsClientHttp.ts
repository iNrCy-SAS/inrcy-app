export type AdsApiRequestError = Error & {
  code?: string;
  requestId?: string;
  status?: number;
};

/** Preserve response metadata for public-message classification and retry guards. */
export function createAdsApiRequestError(payload: unknown, status: number): AdsApiRequestError {
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = data.error && typeof data.error === "object" ? data.error as Record<string, unknown> : {};
  const message = String(data.error || "Le service est momentanément indisponible. Réessayez dans un instant.");
  const error = new Error(
    /migration|stockage|relation .* does not exist/i.test(message)
      ? "L’enregistrement des campagnes sera bientôt disponible. Vous pouvez déjà préparer vos messages."
      : message,
    { cause: payload },
  ) as AdsApiRequestError;
  const code = data.error_code || data.code || data.errorCode || nested.error_code || nested.code || nested.errorCode;
  error.code = typeof code === "string" ? code : undefined;
  error.requestId = typeof data.requestId === "string" ? data.requestId : undefined;
  error.status = status;
  return error;
}

export async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw createAdsApiRequestError(data, response.status);
  }
  return data;
}

export async function readAdsConnectionStatus(response: Response) {
  if (!response.ok) {
    const data = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    // A provider error can carry a confirmed revocation. Do not preserve an
    // old green snapshot when the server explicitly reports that disconnection.
    if (data.connected === false && ["needs_update", "needs_reconnect", "disconnected"].includes(String(data.status))) return data;
  }
  return readJson(response);
}
