/** The callback exposes fixed codes, never the provider's raw response. */
export function linkedInAdsConnectionErrorMessage(reason: string | null): string {
  switch (reason) {
    case "authorization_invalid":
      return "La vérification de votre autorisation LinkedIn Ads a échoué après le retour vers iNrCy. Relancez la connexion.";
    case "provider_unavailable":
      return "LinkedIn est momentanément indisponible pour vérifier la connexion. Réessayez dans quelques instants.";
    case "provider_invalid_response":
    case "scope_verification_failed":
      return "LinkedIn n’a pas renvoyé les informations nécessaires pour vérifier votre connexion. Réessayez dans quelques instants.";
    case "missing_scopes":
      return "Les permissions LinkedIn Ads nécessaires ne sont pas toutes disponibles. Relancez la connexion pour autoriser l’accès demandé par iNrCy Ads.";
    case "ads_access_denied":
      return "LinkedIn a accepté la connexion, mais refuse l’accès à son API publicitaire. Les droits de l’application doivent être vérifiés.";
    case "authorization_cancelled":
    case "user_cancelled_login":
    case "user_cancelled_authorize":
      return "La connexion LinkedIn a été annulée. Vous pouvez la relancer.";
    case "rate_limited":
      return "Plusieurs connexions LinkedIn ont été tentées récemment. Patientez quelques minutes avant de réessayer.";
    case "oauth_state_invalid":
    case "auth_required":
      return "La session de connexion LinkedIn a expiré. Relancez la connexion depuis iNrCy.";
    default:
      return "La connexion LinkedIn Ads n’a pas abouti. Réessayez ou contactez l’assistance iNrCy si le problème persiste.";
  }
}
