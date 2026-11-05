import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
export const INR_ASSISTANT_ACCOUNT_UI_COMMANDS = ["download_account_export", "download_subscription_invoice", "configure_cookie_consent"] as const;
export type InrAssistantAccountUiCommandName = typeof INR_ASSISTANT_ACCOUNT_UI_COMMANDS[number];
/** Plan detection only. Native account tools still verify scope and exact target. */
export function isInrAssistantAccountUiRequest(message: string, command: string): boolean {
  const text = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/^(?:comment|pourquoi|explique|how|why|si\b|imagine)|\b(?:si|if|quand|when|apres|avant|demain|plus tard)\b|\bne\b.{0,60}\bpas\b|\bn['’]|\b(?:sans|never|not|don't)\b/.test(text)) return false;
  if (command === "configure_cookie_consent") return /\b(?:active\w*|desactive\w*|accept\w*|refus\w*|autoris\w*|retir\w*)\b/.test(text) && /\bcookies?\b/.test(text);
  if (!/\b(?:telecharg\w*|export\w*|download)\b/.test(text)) return false;
  return command === "download_account_export" ? /\b(?:rgpd|gdpr)\b|\b(?:mes|nos|les) donnees (?:personnelles|du compte|de mon compte)\b/.test(text)
    : command === "download_subscription_invoice" && /\bfactures?\b/.test(text) && /\b(?:abonnement|inrcy|subscription)\b/.test(text);
}
