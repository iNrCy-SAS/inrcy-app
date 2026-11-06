import { BOOSTER_CHANNEL_CONTENT_RULES, type BoosterChannelKey } from "./boosterChannelRules.ts";
import { INSTAGRAM_CAPTION_MAX_LENGTH } from "./instagramCaptionLimits.ts";
import { PINTEREST_DESCRIPTION_MAX_LENGTH, PINTEREST_TITLE_MAX_LENGTH } from "./pinterestTextLimits.ts";
import type { InrAssistantAppGuide } from "./inrAssistantAppGuides.ts";

const CHANNEL_LABELS: Record<BoosterChannelKey, string> = {
  site_web: "Site web", inr_search: "iNr’Search", gmb: "Google Business", facebook: "Facebook",
  instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn", x: "X", tiktok: "TikTok",
  youtube_shorts: "YouTube", pinterest: "Pinterest",
};

const ranges = (Object.entries(BOOSTER_CHANNEL_CONTENT_RULES) as Array<[BoosterChannelKey, typeof BOOSTER_CHANNEL_CONTENT_RULES[BoosterChannelKey]]>)
  .map(([channel, rule]) => `${CHANNEL_LABELS[channel]} : ${(["adapted", "short", "medium", "long", "deep"] as const).map(mode => `${rule[mode].min}–${rule[mode].max}`).join(" / ")} ; corps max ${rule.max}.`)
  .join("\n");

export const INR_ASSISTANT_CONTENT_LIMIT_GUIDES: readonly InrAssistantAppGuide[] = [{
  id: "publication-lengths",
  title: "Longueurs des contenus et limites des légendes par canal",
  keywords: ["longueur", "longueurs", "caractères", "limite", "maximum", "court", "moyen", "long", "approfondi", "instagram", "pinterest", "légende", "caption", "2200", "800"],
  content: [
    "Plages du champ content nouvellement généré, en caractères, dans l’ordre Adapté / Court / Moyen / Long / Approfondi (Premium selon les droits). Titre, CTA et hashtags sont comptés séparément. Ces objectifs éditoriaux ne sont pas les limites API des réseaux.",
    `Instagram : corps généré au plus ${BOOSTER_CHANNEL_CONTENT_RULES.instagram.max}, puis ajusté au budget réel avant revue. La légende finale ne dépasse pas ${INSTAGRAM_CAPTION_MAX_LENGTH} caractères, titre, CTA, URL ou téléphone, séparateurs et hashtags compris. Le compteur est conservateur et identique au contrôle serveur. Les photos sélectionnées et leur éventuel lien sont pris en compte.`,
    `Pinterest : titre au plus ${PINTEREST_TITLE_MAX_LENGTH} ; description finale au plus ${PINTEREST_DESCRIPTION_MAX_LENGTH}, CTA et hashtags compris. La création garde le titre séparé ; l’édition publiée conserve son assemblage existant avec titre dans la description.`,
    ranges,
    "Pour Instagram et Pinterest, une saisie manuelle ou déjà validée n’est pas raccourcie automatiquement à la sauvegarde ; afficher le dépassement et demander sa correction. Le refus de longueur arrive avant le verrou d’édition et l’envoi, donc reste corrigible. Un résultat externe réellement incertain interdit toute relance automatique. Ne pas déduire les autres plafonds API de ce tableau.",
  ].join("\n"),
  sourceFiles: ["lib/boosterChannelRules.ts", "lib/boosterCta.ts", "lib/instagramCaptionLimits.ts", "lib/instagramGeneratedCaption.ts", "lib/pinterestTextLimits.ts", "lib/pinterestTextRules.ts", "lib/inrsend/publicationChannelActions.ts"],
}];
