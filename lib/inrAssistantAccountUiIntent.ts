import { isInrAssistantContentReportSubmitRequest } from "./inrAssistantContentReport.ts";
import { isInrAssistantLocalInterfaceRequest } from "./inrAssistantLocalInterface.ts";
import { isInrAssistantApplicationPreferenceRequest } from "./inrAssistantApplicationPreferences.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { isInrAssistantBadgeLogoThemeRequest } from "./inrAssistantBadgeIdentityTheme.ts";
export const INR_ASSISTANT_ACCOUNT_UI_COMMANDS = ["refresh_badge_theme_from_logo", "submit_content_report", "control_local_interface", "configure_application_preferences", "download_account_export", "download_subscription_invoice", "open_subscription_invoice_link", "configure_cookie_consent"] as const;
export type InrAssistantAccountUiCommandName = typeof INR_ASSISTANT_ACCOUNT_UI_COMMANDS[number];
/** Plan detection only. Native account tools still verify scope and exact target. */
export function isInrAssistantAccountUiRequest(message: string, command: string): boolean {
  if (command === "submit_content_report") return isInrAssistantContentReportSubmitRequest(message);
  if (command === "refresh_badge_theme_from_logo") return isInrAssistantBadgeLogoThemeRequest(message);
  if (command === "control_local_interface") return isInrAssistantLocalInterfaceRequest(message);
  if (command === "configure_application_preferences") return isInrAssistantApplicationPreferenceRequest(message);
  const text = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/^(?:comment|pourquoi|explique|how|why|si\b|imagine)|\b(?:si|if|quand|when|apres|avant|demain|plus tard)\b|\bne\b.{0,60}\bpas\b|\bn['’]|\b(?:sans|never|not|don't)\b/.test(text)) return false;
  if (command === "configure_cookie_consent") return /\b(?:active\w*|desactive\w*|accept\w*|refus\w*|autoris\w*|retir\w*)\b/.test(text) && /\bcookies?\b/.test(text);
  if (command === "open_subscription_invoice_link") return !/\bpdf\b/.test(text) && /\b(?:ouvr\w*|affich\w*|montr\w*|consulte\w*|open|view|show)\b/.test(text) && /\bfactures?\b/.test(text) && /\b(?:abonnement|souscription|inrcy|subscription)\b/.test(text);
  if (!/\b(?:telecharg\w*|export\w*|download)\b/.test(text)) return false;
  return command === "download_account_export" ? /\b(?:rgpd|gdpr)\b|\b(?:mes|nos|les) donnees (?:personnelles|du compte|de mon compte)\b/.test(text)
    : command === "download_subscription_invoice" && /\bfactures?\b/.test(text) && /\b(?:abonnement|inrcy|subscription)\b/.test(text);
}
