import type { DashboardEdition } from "./dashboardEdition.ts";

/** An allowed tool name never grants all of its commands. Keep the Basic
 * command surface independent from Premium/commercial form handlers. */
export const INR_ASSISTANT_BASIC_SCREEN_COMMANDS = [
  "configure_video_retouch", "select_video_source", "save_video_retouch", "optimize_media",
  "select_image_source", "configure_image_retouch", "reset_image_retouch", "save_image_retouch",
  "download_media", "download_stats_report", "download_account_export", "download_subscription_invoice", "configure_cookie_consent",
  "generate_website_widget_code", "show_website_widget_code", "copy_website_widget_code",
  "configure_business_form", "configure_media_library", "configure_stats_view", "download_badge_qr",
] as const;

export function isInrAssistantScreenCommandAllowed(edition: DashboardEdition, command: string): boolean {
  return edition !== "basic" || INR_ASSISTANT_BASIC_SCREEN_COMMANDS.some(allowed => allowed === command);
}
