import type { ChannelKey } from "../publishModal.shared";

export const PUBLISH_CHANNEL_IDENTITY: Record<ChannelKey, {
  icon: string; color: string; rgb: string; gradient: string;
}> = {
  site_web: { icon: "/icons/site-web.jpg", color: "#35c8ea", rgb: "53,200,234", gradient: "linear-gradient(135deg,#1c9ede,#22d3c1)" },
  gmb: { icon: "/icons/google.jpg", color: "#69a5ff", rgb: "105,165,255", gradient: "linear-gradient(135deg,#4285f4,#34a853,#fbbc05)" },
  inr_search: { icon: "/icons/inr-search-bubble-128.png", color: "#a28bff", rgb: "162,139,255", gradient: "linear-gradient(135deg,#47baff,#a54dff)" },
  facebook: { icon: "/icons/facebook.png", color: "#579bff", rgb: "87,155,255", gradient: "linear-gradient(135deg,#0b69ed,#4596ff)" },
  instagram: { icon: "/icons/instagram.jpg", color: "#9c83f7", rgb: "156,131,247", gradient: "linear-gradient(135deg,#6946d6,#a88df5)" },
  threads: { icon: "/icons/threads.svg", color: "#d1b994", rgb: "209,185,148", gradient: "linear-gradient(135deg,#8c755b,#d9c6a9)" },
  linkedin: { icon: "/icons/linkedin.png", color: "#49a7e9", rgb: "73,167,233", gradient: "linear-gradient(135deg,#0077b5,#3caff0)" },
  tiktok: { icon: "/icons/tiktok.png", color: "#58d8d7", rgb: "88,216,215", gradient: "linear-gradient(110deg,#25f4ee,#53a8d3)" },
  youtube_shorts: { icon: "/icons/youtube-shorts.png", color: "#e4c27c", rgb: "228,194,124", gradient: "linear-gradient(135deg,#b58d48,#edd49e)" },
  pinterest: { icon: "/icons/pinterest-logo-128.png", color: "#c09aff", rgb: "192,154,255", gradient: "linear-gradient(135deg,#9472d8,#d8baff)" },
  x: { icon: "/icons/x.svg", color: "#8eaccc", rgb: "142,172,204", gradient: "linear-gradient(135deg,#41536d,#91aac7)" },
};
