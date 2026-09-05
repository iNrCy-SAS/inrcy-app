function externalErrorMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error || "").toLowerCase();
}

/**
 * Reconnaît uniquement les échecs qui imposent de renouveler une autorisation.
 * Le texte brut du fournisseur reste strictement côté serveur : l'interface
 * reçoit ensuite un message générique qui ne peut contenir ni jeton ni secret.
 */
export function isBusinessDnaReconnectError(error: unknown) {
  const message = externalErrorMessage(error);
  return /(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid[_\s-]?grant|invalid[_\s-]?token|reauthori[sz]|reconnect|token[^\n]{0,50}(?:expired|revoked|invalid)|(?:expired|revoked|invalid)[^\n]{0,50}token|oauth[^\n]{0,50}(?:expired|revoked|invalid|denied)|(?:expired|revoked|invalid|denied)[^\n]{0,50}oauth|autorisation[^\n]{0,50}(?:indisponible|expir[ée]e?|invalide|révoquée))/i.test(message);
}

export function shouldBusinessDnaSourceReconnect(args: {
  error: unknown;
  oauthProtected: boolean;
  requiresUpdate?: boolean;
}) {
  return Boolean(
    args.requiresUpdate ||
      (args.oauthProtected && isBusinessDnaReconnectError(args.error)),
  );
}

export function canCollectBusinessDnaSource(args: {
  connected: boolean;
  requiresUpdate?: boolean;
}) {
  return args.connected && !args.requiresUpdate;
}

export function areAllBusinessDnaRequestsRejected(
  ...results: PromiseSettledResult<unknown>[]
) {
  return results.length > 0 && results.every((result) => result.status === "rejected");
}

/**
 * Lorsque plusieurs sous-appels d'un même canal échouent, privilégie l'erreur
 * d'autorisation. Ainsi, un 500 sur le profil ne masque pas un 401 sur le flux
 * et l'interface peut demander la reconnexion au lieu d'afficher un échec vague.
 */
export function pickBusinessDnaRejectedReason(
  ...results: PromiseSettledResult<unknown>[]
) {
  const reasons = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  return reasons.find(isBusinessDnaReconnectError) || reasons[0] || new Error("Source externe indisponible.");
}

export function findBusinessDnaReconnectRejectedReason(
  ...results: PromiseSettledResult<unknown>[]
) {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason)
    .find(isBusinessDnaReconnectError) || null;
}
