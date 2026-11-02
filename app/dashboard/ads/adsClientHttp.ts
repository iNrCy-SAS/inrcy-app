export type AdsApiRequestError = Error & {
  code?: string;
  requestId?: string;
  status?: number;
};

export async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(data.error || "Le service est momentanément indisponible. Réessayez dans un instant.");
    const error = new Error(
      /migration|stockage|relation .* does not exist/i.test(message)
        ? "L’enregistrement des campagnes sera bientôt disponible. Vous pouvez déjà préparer vos messages."
        : message,
    ) as AdsApiRequestError;
    error.code = typeof data.code === "string" ? data.code : undefined;
    error.requestId = typeof data.requestId === "string" ? data.requestId : undefined;
    error.status = response.status;
    throw error;
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
