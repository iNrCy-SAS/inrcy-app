import inrcyBubbleIcon from "../../public/icons/inrcy.png";
import siteWebBubbleIcon from "../../public/icons/site-web.jpg";
import facebookBubbleIcon from "../../public/icons/facebook.png";
import googleBusinessBubbleIcon from "../../public/icons/google.jpg";
import inrSearchBubbleIcon from "../../public/icons/inr-search-bubble-128.png";
import instagramBubbleIcon from "../../public/icons/instagram.jpg";
import linkedinBubbleIcon from "../../public/icons/linkedin.png";
import mailsBubbleIcon from "../../public/icons/mails-inrcy-dashboard-v2.png";
import tiktokBubbleIcon from "../../public/icons/tiktok.png";
import youtubeBubbleIcon from "../../public/icons/youtube-shorts.png";
import pinterestBubbleIcon from "../../public/icons/pinterest-logo-128.png";
import inrAgentBubbleIcon from "../../public/icons/inr-agent.png";
import inrBadgeBubbleIcon from "../../public/icons/inrbadge-dashboard.png";

import type { Module, GoogleSource } from "./dashboard.types";

export const MODULE_ICONS: Record<string, { src: string; alt: string }> = {
  site_inrcy: { src: inrcyBubbleIcon.src, alt: "iNrCy" },
  site_web: { src: siteWebBubbleIcon.src, alt: "Site web" },
  facebook: { src: facebookBubbleIcon.src, alt: "Facebook" },
  gmb: { src: googleBusinessBubbleIcon.src, alt: "Google Business" },
  inr_search: { src: inrSearchBubbleIcon.src, alt: "iNr'Search" },
  instagram: { src: instagramBubbleIcon.src, alt: "Instagram" },
  linkedin: { src: linkedinBubbleIcon.src, alt: "LinkedIn" },
  mails: { src: mailsBubbleIcon.src, alt: "Mails iNrCy" },
  tiktok: { src: tiktokBubbleIcon.src, alt: "TikTok" },
  youtube_shorts: { src: youtubeBubbleIcon.src, alt: "YouTube" },
  pinterest: { src: pinterestBubbleIcon.src, alt: "Pinterest" },
  inr_agent: { src: inrAgentBubbleIcon.src, alt: "iNr'Agent" },
  inrbadge: { src: inrBadgeBubbleIcon.src, alt: "iNr'Badge" },
};

export const DASHBOARD_BUBBLE_ICON_PRELOADS = Object.values(MODULE_ICONS).map((icon) => icon.src);

export const fluxModules: Module[] = [
  {
    key: "inrbadge",
    name: "iNr'Badge",
    description: "Mon entreprise en QR Code",
    status: "available",
    accent: "purple",
    actions: [
      { key: "view", label: "Voir mon badge", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Configurer",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "site_web",
    name: "Site web",
    description: "Convertit vos visiteurs 💡",
    status: "available",
    accent: "pink",
    actions: [
      { key: "view", label: "Voir le site", variant: "view", href: "#" },
      {
        key: "ga4",
        label: "Connecter Google Analytics",
        variant: "connect",
        onClick: () => {},
      },
      {
        key: "gsc",
        label: "Connecter Search Console",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "gmb",
    name: "Google Business",
    description: "Augmente les appels 📞",
    status: "available",
    accent: "orange",
    actions: [
      { key: "view", label: "Voir la page", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Configurer",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "inr_search",
    name: "iNr'Search",
    description: "Votre page créée par iNrCy 🔎",
    status: "available",
    accent: "cyan",
    actions: [
      { key: "view", label: "Voir ma page", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Configurer",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "facebook",
    name: "Facebook",
    description: "Crée de la demande 📈",
    status: "available",
    accent: "cyan",
    actions: [
      { key: "view", label: "Voir le compte", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Connecter Facebook",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "instagram",
    name: "Instagram",
    description: "Développe votre marque 📸",
    status: "available",
    accent: "pink",
    actions: [
      { key: "view", label: "Voir le compte", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Connecter Instagram",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    description: "Crédibilise votre expertise 💼",
    status: "available",
    accent: "cyan",
    actions: [
      { key: "view", label: "Voir le compte", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Connecter LinkedIn",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "tiktok",
    name: "TikTok",
    description: "Développe votre audience 🎬",
    status: "available",
    accent: "pink",
    actions: [
      { key: "view", label: "Voir le compte", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Configurer",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "youtube_shorts",
    name: "YouTube",
    description: "Diffuse en vidéo ▶️",
    status: "available",
    accent: "pink",
    actions: [
      {
        key: "view",
        label: "Voir la chaîne",
        variant: "view",
        href: "#",
      },
      {
        key: "connect",
        label: "Configurer",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "pinterest",
    name: "Pinterest",
    description: "Inspire vos clients 📌",
    status: "available",
    accent: "pink",
    actions: [
      { key: "view", label: "Voir le compte", variant: "view", href: "#" },
      {
        key: "connect",
        label: "Configurer",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "mails",
    name: "Mails",
    description: "Diffuse à votre réseau ✉️",
    status: "available",
    accent: "cyan",
    actions: [
      {
        key: "view",
        label: "Ouvrir iNr\'Send",
        variant: "view",
        href: "/dashboard/mails",
      },
      {
        key: "connect",
        label: "Configurer",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
  {
    key: "site_inrcy",
    name: "Site iNrCy",
    description: "Votre machine à leads ⚡",
    status: "available",
    accent: "purple",
    actions: [
      { key: "view", label: "Voir le site", variant: "view", href: "#" },
      {
        key: "ga4",
        label: "Connecter Google Analytics",
        variant: "connect",
        onClick: () => {},
      },
      {
        key: "gsc",
        label: "Connecter Search Console",
        variant: "connect",
        onClick: () => {},
      },
    ],
  },
];

export const DRAWER_TITLES = {
  contact: "Nous contacter",
  compte: "Compte iNrCytizen",
  profil: "Mon profil",
  preferences: "Préférences générales",
  inrbadge: "Réglages iNr'Badge",
  activite: "Mon profil",
  ia: "Configuration IA",
  abonnement: "Mon abonnement",
  legal: "Informations légales",
  rgpd: "Mes données (RGPD)",
  mails: "Réglages Mails",
  agenda: "Réglages iNr’Calendar",
  site_inrcy: "Configuration — Site iNrCy",
  site_web: "Configuration — Site web",
  instagram: "Configuration — Instagram",
  linkedin: "Configuration — LinkedIn",
  gmb: "Configuration — Google Business",
  inr_search: "Configuration — iNr'Search",
  facebook: "Configuration — Facebook",
  tiktok: "Configuration — TikTok",
  youtube_shorts: "Configuration — YouTube",
  pinterest: "Configuration — Pinterest",
  inertie: "Mon inertie",
  boutique: "Boutique",
  parrainage: "Parrainer avec iNrCy",
  notifications: "Notifications",
  documents: "Réglages par défaut",
} as const satisfies Record<string, string>;

export const DRAWER_PANELS = new Set(Object.keys(DRAWER_TITLES));
export const GOOGLE_SOURCES: readonly GoogleSource[] = [
  "site_inrcy",
  "site_web",
] as const;
