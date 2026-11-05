/** Known mounted forms that may continue an ordered task after navigation.
 * These public capabilities never authorize the form's business operation. */
export const INR_ASSISTANT_NAVIGATION_FORMS: Readonly<Record<string, { pathname: string; kind: string; commands: readonly string[] }>> = {
  studio_image_retouch: {pathname:"/dashboard/generer-media",kind:"media",commands:["select_image_source","configure_image_retouch","reset_image_retouch","save_image_retouch"]},
  studio_video_retouch: {pathname:"/dashboard/generer-media",kind:"media",commands:["select_video_source","configure_video_retouch","save_video_retouch"]},
  stats: {pathname:"/dashboard/stats",kind:"stats",commands:["configure_stats_view"]},
  badge: {pathname:"/dashboard",kind:"channel",commands:["download_badge_qr"]},
  website: {pathname:"/dashboard",kind:"channel",commands:["generate_website_widget_code","show_website_widget_code","copy_website_widget_code"]},
  media: {pathname:"/dashboard/mediatheque",kind:"media",commands:["configure_media_library"]},
};
export function inrAssistantNavigationForm(destination: string) { return INR_ASSISTANT_NAVIGATION_FORMS[destination]; }
