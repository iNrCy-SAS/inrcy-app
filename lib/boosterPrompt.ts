import {
  buildCompactAiWritingDirective,
  getAiLanguageLabel,
} from "@/lib/aiWritingProfile";
import {
  buildNormalizedAiGenerationProfile,
  type NormalizedAiGenerationProfile,
} from "@/lib/aiGenerationProfile";
import {
  formatBoosterGeneratedContentRule,
  INR_SEARCH_CONTENT_MAX_LENGTH,
  type BoosterChannelKey,
} from "@/lib/boosterChannelRules";

export type BoosterChannels = BoosterChannelKey;

export type BoosterTheme =
  | ""
  | "promotion"
  | "information"
  | "conseil"
  | "avis_client"
  | "realisation"
  | "actualite"
  | "autre";

export type BoosterStyle = "sobre" | "equilibre" | "dynamique";

export type BoosterHiddenAngle =
  | "retour_terrain"
  | "conseil_pratique"
  | "coulisses"
  | "storytelling"
  | "question_engageante"
  | "mini_astuce"
  | "proximite_locale"
  | "preuve_concrete";

export type BoosterRecentPublication = {
  title?: string | null;
  content?: string | null;
  cta?: string | null;
  idea?: string | null;
  created_at?: string | null;
};

const CHANNEL_LABELS: Record<BoosterChannels, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr'Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

const THEME_LABELS: Record<BoosterTheme, string> = {
  "": "Non précisé",
  promotion: "Promotion",
  information: "Information",
  conseil: "Conseil / Astuce",
  avis_client: "Avis client / preuve sociale",
  realisation: "Réalisation / intervention / chantier",
  actualite: "Actualité / nouveauté",
  autre: "Autre",
};

const STYLE_LABELS: Record<BoosterStyle, string> = {
  sobre: "Sobre",
  equilibre: "Équilibré",
  dynamique: "Dynamique",
};

const HIDDEN_ANGLE_LABELS: Record<BoosterHiddenAngle, string> = {
  retour_terrain: "Retour terrain",
  conseil_pratique: "Conseil pratique",
  coulisses: "Coulisses du métier",
  storytelling: "Petite histoire concrète",
  question_engageante: "Question engageante",
  mini_astuce: "Mini astuce",
  proximite_locale: "Proximité locale",
  preuve_concrete: "Preuve concrète",
};

const HIDDEN_ANGLE_INSTRUCTIONS: Record<BoosterHiddenAngle, string> = {
  retour_terrain:
    "Partir d'une situation réaliste vécue sur le terrain ou d'une intervention du quotidien, sans inventer de détail précis non fourni.",
  conseil_pratique:
    "Apporter un conseil simple et utile au lecteur, relié naturellement à l'intention du pro.",
  coulisses:
    "Montrer discrètement l'envers du décor : préparation, méthode, soin apporté, organisation ou façon de travailler.",
  storytelling:
    "Donner une impression de petite histoire concrète avec un début naturel, mais sans créer de faux client, faux lieu ou faux événement.",
  question_engageante:
    "Ouvrir ou rythmer le message avec une question naturelle qui parle au besoin du lecteur, sans faire racoleur.",
  mini_astuce:
    "Glisser une astuce courte, pratique et facile à comprendre, sans transformer le post en tutoriel complet.",
  proximite_locale:
    "Renforcer la proximité avec la ville, les zones ou les habitudes locales, de manière naturelle et non répétitive.",
  preuve_concrete:
    "Mettre en avant des éléments concrets : prestation, méthode, réactivité, soin, résultat attendu ou point de vigilance, sans promesse exagérée.",
};

const PREFERRED_ANGLE_VARIATIONS: Record<string, BoosterHiddenAngle[]> = {
  local: ["proximite_locale", "retour_terrain", "coulisses", "storytelling"],
  quality: ["preuve_concrete", "coulisses", "retour_terrain", "conseil_pratique"],
  price: ["conseil_pratique", "mini_astuce", "preuve_concrete", "question_engageante"],
  speed: ["retour_terrain", "preuve_concrete", "coulisses", "question_engageante"],
  trust: ["retour_terrain", "storytelling", "preuve_concrete", "coulisses"],
};

export function pickBoosterHiddenAngle(preferredAngle?: string | null): BoosterHiddenAngle {
  const compatible = PREFERRED_ANGLE_VARIATIONS[String(preferredAngle || "").trim()] ||
    (Object.keys(HIDDEN_ANGLE_LABELS) as BoosterHiddenAngle[]);
  return compatible[Math.floor(Math.random() * compatible.length)] || "retour_terrain";
}

function cleanText(value: unknown, maxLength = 220) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanList(value: unknown, maxItems = 8, maxItemLength = 70) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,;\n]/)
        .map((item) => item.trim());

  return Array.from(
    new Set(
      rawItems.map((item) => cleanText(item, maxItemLength)).filter(Boolean),
    ),
  ).slice(0, maxItems);
}

function formatRecentPublications(
  publications?: BoosterRecentPublication[] | null,
) {
  if (!Array.isArray(publications) || !publications.length) return "";

  return publications
    .slice(0, 5)
    .map((publication, index) => {
      const title = cleanText(publication.title, 90);
      const idea = cleanText(publication.idea, 120);
      const content = cleanText(publication.content, 220);
      const cta = cleanText(publication.cta, 80);

      const parts = [
        title ? `titre: ${title}` : "",
        idea ? `idée: ${idea}` : "",
        content ? `extrait: ${content}` : "",
        cta ? `cta: ${cta}` : "",
      ].filter(Boolean);

      return parts.length ? `${index + 1}. ${parts.join(" | ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

const CHANNEL_COMPACT_CONTRACTS: Record<BoosterChannels, string> = {
  inrcy_site:
    "Actualité site iNrCy, utile et locale. SEO naturel + conversion douce. Titre 45–70. Paragraphes aérés. Jusqu’à 2–5 expressions **en gras** si utile. Liste SEO facultative, sans emoji.",
  site_web:
    "Contenu web durable, crédible et plus riche. SEO local naturel. Titre 45–70. Différent du Site iNrCy. Paragraphes aérés, liste SEO facultative, sans emoji.",
  inr_search:
    `iNr'Search : titre clair et un contenu court, utile et directement exploitable. En mode détaillé, utilise deux phrases complémentaires si elles tiennent naturellement dans la limite. Contenu limité à ${INR_SEARCH_CONTENT_MAX_LENGTH} caractères maximum. Sans emoji ni hashtags.`,
  gmb:
    "Google Business factuel, local, utile et sobre. Titre 40–70. Zéro hashtag, téléphone, email, URL, remise ou promesse invérifiable. CTA neutre seulement si utile.",
  facebook:
    "Facebook humain, local et conversationnel. Titre 40–80. Proximité et interaction naturelle. Mini-liste facultative. CTA non agressif.",
  instagram:
    "Instagram visuel, vivant et spontané. Titre 35–70. Paragraphes courts. Hashtags ciblés si utiles. Ne jamais inventer ‘lien en bio’.",
  linkedin:
    "LinkedIn professionnel, humain et crédible. Titre 45–90. Expertise, méthode, recul ou retour terrain. Peu d’emojis, pas de ton vendeur artificiel.",
  tiktok:
    "TikTok direct, vivant et concret. Titre 30–70. Pensé pour accompagner vidéo/photos. Hashtags ciblés si utiles. Éviter le ton institutionnel.",
  youtube_shorts:
    "YouTube prêt à publier. Titre 45–90. Description SEO, sujet réel d’abord, mots-clés naturels. Aucun commentaire méta sur la rédaction.",
  pinterest:
    "Pinterest inspirant, utile et enregistrable. Titre 35–80. Bénéfice concret, idée visuelle et mots-clés recherchables. Hashtags seulement s’ils apportent une valeur réelle.",
};

type BoosterLengthPreference = NormalizedAiGenerationProfile["preferences"]["length"];

function getChannelLengthTarget(
  length: BoosterLengthPreference,
  channel: BoosterChannels,
) {
  return formatBoosterGeneratedContentRule(channel, length);
}

type BoosterEmojiPreference = NormalizedAiGenerationProfile["preferences"]["emojiLevel"];

const CHANNEL_EMOJI_TARGETS: Record<
  BoosterEmojiPreference,
  Record<BoosterChannels, string>
> = {
  none: {
    inrcy_site: "0 emoji.",
    site_web: "0 emoji.",
    inr_search: "0 emoji.",
    gmb: "0 emoji.",
    facebook: "0 emoji.",
    instagram: "0 emoji.",
    linkedin: "0 emoji.",
    tiktok: "0 emoji.",
    youtube_shorts: "0 emoji.",
    pinterest: "0 emoji.",
  },
  light: {
    inrcy_site: "0 emoji.",
    site_web: "0 emoji.",
    inr_search: "0 emoji.",
    gmb: "0–1 emoji seulement si naturel.",
    facebook: "1–3 emojis maximum, bien répartis.",
    instagram: "2–5 emojis utiles, sans décoration automatique.",
    linkedin: "0–2 emojis maximum, très sobres.",
    tiktok: "2–5 emojis vivants si pertinents.",
    youtube_shorts: "0–3 emojis utiles, sans nuire au SEO.",
    pinterest: "1–3 emojis utiles si l'idée visuelle s'y prête.",
  },
  dynamic: {
    inrcy_site: "0 emoji malgré le niveau Beaucoup : priorité SEO et lisibilité.",
    site_web: "0 emoji malgré le niveau Beaucoup : priorité SEO et lisibilité.",
    inr_search: "0 emoji malgré le niveau Beaucoup : priorité SEO et lisibilité.",
    gmb: "1–2 emojis sobres et utiles, bien répartis.",
    facebook: "6–10 emojis visibles et naturellement répartis.",
    instagram: "8–12 emojis visibles, variés et répartis dans le texte.",
    linkedin: "2–4 emojis maximum : présence visible mais professionnelle.",
    tiktok: "8–12 emojis visibles, vivants et répartis naturellement.",
    youtube_shorts: "4–7 emojis visibles, sans nuire aux mots-clés.",
    pinterest: "4–7 emojis visibles si cohérents avec l'inspiration et la recherche.",
  },
};

function buildBoosterEmojiDirective(
  emojiLevel: BoosterEmojiPreference,
  channels: BoosterChannels[],
) {
  const labels: Record<BoosterEmojiPreference, string> = {
    none: "AUCUN",
    light: "LÉGER",
    dynamic: "BEAUCOUP",
  };
  const targets = Array.from(new Set(channels))
    .map((channel) => `- ${CHANNEL_LABELS[channel]} : ${CHANNEL_EMOJI_TARGETS[emojiLevel][channel]}`)
    .join("\n");

  const priority =
    emojiLevel === "none"
      ? "Consigne forte : aucun emoji sur les canaux demandés."
      : emojiLevel === "dynamic"
        ? "Consigne forte et contrôlée : sur les canaux sociaux compatibles, les emojis doivent être vraiment nombreux, visibles et répartis dans title/content/cta. Les canaux site restent strictement sans emoji."
        : "Consigne éditoriale : présence discrète mais perceptible sur les canaux compatibles.";

  return `EMOJIS ${labels[emojiLevel]} — INTENSITÉ VISIBLE\n${priority}\nLes repères ci-dessous pilotent réellement la quantité attendue. Pour BEAUCOUP, respecte au moins le bas de la plage sur chaque canal compatible, sans série mécanique ni emoji hors sujet.\n${targets}`;
}

function buildBoosterLengthDirective(
  length: BoosterLengthPreference,
  channels: BoosterChannels[],
) {
  const labels: Record<BoosterLengthPreference, string> = {
    short: "COURT",
    medium: "MOYEN",
    detailed: "DÉTAILLÉ",
  };
  const targets = Array.from(new Set(channels))
    .map(
      (channel) =>
        `- ${CHANNEL_LABELS[channel]} : ${getChannelLengthTarget(length, channel)}`,
    )
    .join("\n");

  const priority =
    length === "detailed"
      ? "Consigne éditoriale forte : développe réellement le sujet, apporte du contexte, de la matière utile et plusieurs idées distinctes. Ne résume pas en 2–3 phrases. Vise au minimum le bas de chaque plage sans inventer de faits."
      : length === "short"
        ? "Reste volontairement concis tout en conservant un contenu complet et publiable."
        : "Produis un contenu suffisamment développé, sans remplissage ni résumé excessif.";

  return `LONGUEUR ${labels[length]} — PRIORITÉ ÉDITORIALE\n${priority}\nLes plages ci-dessous concernent exclusivement le champ content : title, cta et hashtags sont séparés. Elles pilotent réellement la quantité de texte attendue et ne sont pas décoratives. Le maximum absolu propre à chaque canal est un plafond technique iNrCy confortable : ne le dépasse jamais, même en mode DÉTAILLÉ ou si une consigne ponctuelle demande un texte plus long. Si le contexte factuel est limité, développe l'explication, le bénéfice, la méthode ou le contexte sans inventer de faits.\n${targets}`;
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }),
  );
}

function compactLongPromptContext(value: unknown, maxChars = 5_000) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  if (!text || text.length <= maxChars) return text;
  const marker = "\n[… contexte média compacté par iNrCy …]\n";
  const room = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(room * 0.72);
  return `${text.slice(0, head)}${marker}${text.slice(-(room - head))}`;
}

function buildCompactBusinessPayload(profile: NormalizedAiGenerationProfile) {
  const business = profile.business;
  return compactRecord({
    entreprise: cleanText(business.companyName, 100),
    ville: cleanText(business.city, 80),
    code_postal: cleanText(business.postalCode, 20),
    secteur: cleanText(business.sectorLabel, 90),
    metier: cleanText(business.professionLabel, 120),
    description: cleanText(business.description, 520),
    prestations: cleanList(business.services, 8, 90),
    zones: cleanList(business.interventionZones, 6, 80),
    forces: cleanList(business.strengths, 5, 80),
    clienteles: cleanList(business.customerTypologies, 5, 60),
    jours_et_horaires_ouverture: cleanText(
      business.openingHours || business.openingDays,
      1_200,
    ),
    telephone: cleanText(business.phone, 60),
    email: cleanText(business.email, 100),
  });
}

function buildCompactPreferencePayload(profile: NormalizedAiGenerationProfile) {
  const preferences = profile.preferences;
  return compactRecord({
    langue: preferences.language,
    ton: preferences.tone,
    style_communication: preferences.communicationStyle,
    creativite: preferences.creativity,
    longueur: preferences.length,
    emojis: preferences.emojiLevel,
    voix: preferences.voice,
    relation_lecteur: preferences.addressMode,
    intensite_commerciale: preferences.commercialLevel,
    objectif: preferences.mainGoal,
    angle_prefere: preferences.preferredAngle,
    cta_prefere: preferences.preferredCta,
    exemple_aime: cleanText(preferences.likedExample, 1200),
    a_eviter: cleanText(preferences.customInstructions, 700),
  });
}

function formatCompactChannelContracts(
  channels: BoosterChannels[],
  _length: BoosterLengthPreference,
) {
  // La grille de longueur est détaillée une seule fois dans POLITIQUE DE LONGUEUR
  // afin de ne pas alourdir le prompt ni le temps de génération.
  return Array.from(new Set(channels))
    .map(
      (channel) =>
        `- ${channel} (${CHANNEL_LABELS[channel]}) : ${CHANNEL_COMPACT_CONTRACTS[channel]}`,
    )
    .join("\n");
}

export function boosterSystemPrompt(
  source?: unknown,
  publicationInstruction?: string,
) {
  const normalized = buildNormalizedAiGenerationProfile({ business: source });
  const language = getAiLanguageLabel(normalized);
  const hasPublicationInstruction = Boolean(cleanText(publicationInstruction, 4_000));

  return `RÔLE : rédacteur marketing local iNrCy. Produis uniquement des contenus finaux prêts à publier.

LANGUE FINALE : toutes les valeurs visibles (title, content, cta, hashtags textuels) sont exclusivement en ${language}. Les clés JSON restent inchangées. Noms propres, marques, URLs, emails et termes exacts fournis peuvent rester tels quels.${hasPublicationInstruction ? " La consigne ponctuelle a déjà été prise en compte pour résoudre une éventuelle dérogation explicite de langue." : ""}

PRIORITÉ DE VÉRITÉ, DE SUJET ET D’INSTRUCTIONS :
1. Vérité des faits, sécurité et contraintes techniques du canal.
2. La phrase libre du pro définit le sujet obligatoire.
3. Si elle existe, lis la consigne ponctuelle comme un message direct du pro au moteur IA actif : applique-la avec ton propre jugement d’auteur. Elle est prioritaire sur la Configuration IA générale pour tous les points qu’elle précise.
4. Les médias joints enrichissent le sujet sans jamais le changer.
5. La Configuration IA générale s’applique sur tous les points non remplacés par la consigne ponctuelle.
6. Le profil métier contextualise seulement avec des faits fournis.
7. Le canal adapte angle, profondeur, rythme et vocabulaire.
N’invente jamais client, lieu, prix, résultat, certification, avis, date ou détail précis absent du contexte.

RÈGLES DURES :
- Respecte les préférences explicites du pro : langue, pronom, tutoiement/vouvoiement et interdits personnalisés.
- Chaque canal demandé reçoit une vraie adaptation, jamais un copier-coller.
- Écris comme un professionnel réel : naturel, concret, crédible, sans jargon marketing ni formules IA génériques.
- Relis silencieusement l'intégralité de chaque title, content et cta avant de produire le JSON final. Orthographe, grammaire, conjugaison, accords, ponctuation et typographie doivent être irréprochables dans la langue finale.
- Aucune citation, note de bas de page, référence, bibliographie, mention de source ni bloc « Sources ». Interdits notamment : [1], [2][4], [1, 2], 【1†source】 et tout marqueur équivalent.
- Aucun commentaire méta sur la rédaction. Interdits : « la description doit », « ce contenu sert à », « cette publication peut », ou équivalent.
- Utilise des paragraphes courts pour TOUS les canaux. Au-delà de 2–3 phrases, sépare les idées par deux sauts de ligne consécutifs ; ces retours font partie du texte final, ne jamais les supprimer. Laisser le moteur choisir librement le nombre de paragraphes utile. Les listes restent facultatives.
- Hors Site iNrCy/Site web : aucun Markdown ni HTML. Sur les sites seulement, **gras Markdown** modéré si utile.
- Les coordonnées de l’entreprise sont gérées par les champs CTA structurés d’iNrCy : ne recopie jamais téléphone, email ni URL dans title, content ou cta. Même si une coordonnée figure dans le contexte entreprise, elle sert uniquement à comprendre l’activité.
- Le champ cta contient seulement une formule d’action courte, sans téléphone, sans email, sans URL et sans répétition dans content.
- Tous les hashtags doivent être placés exclusivement dans le tableau hashtags, sans #. N’écris aucun hashtag dans title, content ou cta.
- La personnalité native du moteur est souhaitée : iNrCy impose les faits, la conformité et les préférences, pas une recette éditoriale uniforme.

SORTIE : JSON strict. Objet racine {"versions":{...}}. Renvoie uniquement les canaux demandés. Pour chacun : {"title":string,"content":string,"cta":string,"hashtags":string[]}. title/content non vides. La clé cta doit toujours exister mais peut contenir "". hashtags sans #. Aucun texte hors JSON.`;
}

export function boosterUserPrompt(args: {
  idea: string;
  publicationInstruction?: string;
  theme: BoosterTheme;
  style: BoosterStyle;
  channels: BoosterChannels[];
  profile?: Record<string, any> | null;
  business?: Record<string, any> | null;
  generationProfile?: NormalizedAiGenerationProfile;
  hiddenAngle?: BoosterHiddenAngle;
  recentPublications?: BoosterRecentPublication[] | null;
}) {
  const generationProfile =
    args.generationProfile ||
    buildNormalizedAiGenerationProfile({
      profile: args.profile,
      business: args.business,
      idea: args.idea,
      theme: args.theme,
      style: args.style,
    });
  const preferences = generationProfile.preferences;
  const publicationInstruction = cleanText(args.publicationInstruction, 4_000);
  const hiddenAngle =
    args.hiddenAngle || pickBoosterHiddenAngle(generationProfile.preferences.preferredAngle);
  const recentPublicationMemory = formatRecentPublications(args.recentPublications);
  const businessPayload = buildCompactBusinessPayload(generationProfile);
  const preferencePayload = buildCompactPreferencePayload(generationProfile);
  const engineDirective = buildCompactAiWritingDirective(
    generationProfile,
    preferences.engine,
  );
  const channelSet = new Set(args.channels);
  const executionRules = [
    "- Traite d’abord exactement la phrase libre ; le métier et la ville ne servent qu’à rendre le résultat crédible et local.",
    publicationInstruction
      ? "- La consigne ponctuelle est une dérogation temporaire prioritaire et doit être comprise comme un message direct du pro au moteur IA actif : applique-la sur chaque point qu’elle précise avec ton propre jugement d’auteur, même si la Configuration IA générale indique autre chose. Les réglages généraux restent valables pour le reste."
      : "",
    "- Respecte le contrat propre à chaque canal et les préférences du pro, sans transformer ces préférences en gabarit fixe.",
    channelSet.has("inrcy_site") && channelSet.has("site_web")
      ? "- Site iNrCy et Site web : produis deux variantes complètes et réellement distinctes."
      : "",
    channelSet.has("gmb")
      ? "- Google Business : reste strictement factuel et sans coordonnées, URL, hashtag ni promotion agressive ; CTA neutre seulement si utile."
      : "",
    channelSet.has("inrcy_site") || channelSet.has("site_web") || channelSet.has("inr_search")
      ? "- Canaux site : zéro emoji ; SEO local naturel uniquement avec les faits réellement fournis."
      : "",
    preferences.emojiLevel === "dynamic"
      ? "- Niveau emojis BEAUCOUP : sur les canaux sociaux compatibles, le résultat doit contenir réellement beaucoup d'emojis visibles. Ne compense pas par un seul emoji dans le titre : répartis-les naturellement dans le contenu. Les canaux site restent à zéro emoji."
      : "- La politique emojis ci-dessous doit être perceptible, compatible avec chaque canal et respectée sans décoration automatique.",
    "- Le CTA préféré est une orientation, pas une obligation. Le champ cta reste un libellé court : aucune coordonnée et aucune répétition du CTA dans content.",
    "- Téléphone, email et URL du contexte entreprise ne doivent jamais être recopiés dans title, content ou cta : iNrCy les ajoute séparément uniquement lorsque le CTA structuré le demande.",
    "- Place tous les hashtags uniquement dans le tableau hashtags, jamais dans title, content ou cta.",
    preferences.engine === "perplexity"
      ? "- SÉCURITÉ SONAR : utilise tes connaissances uniquement pour expliquer le sujet demandé, mais ne restitue jamais de citations, sources ou références de recherche. N'ajoute aucun chiffre, statistique, date, actualité, nom de quartier, lieu précis, entreprise ou fait local absent du contexte fourni."
      : "",
    "- Conserve les vrais retours à la ligne dans content avec \\n\\n entre paragraphes.",
    "- CONTRÔLE FINAL SILENCIEUX : avant de répondre, vérifie une fois que chaque canal demandé est présent, dans la bonne langue, ancré dans la phrase libre, distinct des autres, sans fuite de consigne ni coordonnée, avec la longueur et les emojis demandés, puis corrige directement le JSON si nécessaire.",
    "- Renvoie uniquement le JSON attendu, sans explication.",
  ].filter(Boolean).join("\n");

  return `MISSION
Phrase libre prioritaire — sujet obligatoire de la publication : ${cleanText(args.idea, 4000)}

CONSIGNE PONCTUELLE PRIORITAIRE — publication en cours uniquement
${publicationInstruction || "Aucune consigne ponctuelle. Appliquer intégralement la Configuration IA générale."}
${publicationInstruction ? "Lis cette consigne comme si le pro parlait directement au moteur IA actif : utilise ton propre jugement d’auteur pour l’appliquer, sauf contradiction avec les règles dures iNrCy (vérité, sécurité, canal, JSON, contraintes techniques). Elle remplace temporairement les réglages généraux uniquement sur les points qu’elle précise. Elle ne peut jamais autoriser l’invention de faits ni contourner les contraintes techniques et de sécurité." : ""}

Thème : ${THEME_LABELS[args.theme]}
Style historique : ${STYLE_LABELS[args.style]} (secondaire face à la Configuration IA)
Canaux exacts : ${args.channels.join(", ")}

CONFIGURATION IA DU PRO
${JSON.stringify(preferencePayload)}

CONTEXTE ENTREPRISE — utiliser seulement si pertinent, ne rien inventer
${JSON.stringify(businessPayload)}

CONTRATS DES SEULS CANAUX DEMANDÉS
${formatCompactChannelContracts(args.channels, preferences.length)}

POLITIQUE DE LONGUEUR
${buildBoosterLengthDirective(preferences.length, args.channels)}

POLITIQUE EMOJIS
${buildBoosterEmojiDirective(preferences.emojiLevel, args.channels)}

LIBERTÉ CRÉATIVE DU MOTEUR
${engineDirective}

VARIATION iNrCy
Angle discret : ${HIDDEN_ANGLE_LABELS[hiddenAngle]} — ${HIDDEN_ANGLE_INSTRUCTIONS[hiddenAngle]}
L’angle reste facultatif : il ne doit jamais détourner la phrase libre ni contredire l’angle préféré du pro.

ANTI-RÉPÉTITION
${recentPublicationMemory || "Aucun historique récent."}
Utilise cet historique uniquement pour éviter les mêmes accroches, structures, CTA ou tournures ; jamais comme source de faits actuels.

EXÉCUTION
${executionRules}`;
}

export function compileBoosterGenerationPrompt(args: {
  idea: string;
  publicationInstruction?: string;
  theme: BoosterTheme;
  style: BoosterStyle;
  channels: BoosterChannels[];
  profile?: Record<string, any> | null;
  business?: Record<string, any> | null;
  generationProfile: NormalizedAiGenerationProfile;
  hiddenAngle?: BoosterHiddenAngle;
  recentPublications?: BoosterRecentPublication[] | null;
  imageCount?: number;
  mediaContext?: unknown;
  extraInstructions?: unknown;
}) {
  const system = boosterSystemPrompt(
    args.generationProfile,
    args.publicationInstruction,
  );
  const core = boosterUserPrompt(args);
  const imageCount = Math.max(0, Number(args.imageCount || 0));
  const mediaContext = compactLongPromptContext(args.mediaContext, 5_000);
  const extraInstructions = compactLongPromptContext(args.extraInstructions, 2_000);

  const mediaDirective = imageCount
    ? `MÉDIAS JOINTS : ${imageCount} image(s). La phrase libre reste prioritaire. Utilise seulement des éléments visuels visibles et prudents pour concrétiser le texte ; n’affirme jamais personne, lieu, marque, date, prix, avant/après ou résultat non certain. Une image ambiguë ou hors sujet peut être ignorée.`
    : "";

  const input = [
    core,
    mediaDirective,
    mediaContext ? `CONTEXTE MÉDIA / TRANSCRIPTION UTILE\n${mediaContext}` : "",
    extraInstructions ? `PRÉCISION D’EXÉCUTION\n${extraInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    system,
    input,
    systemChars: system.length,
    inputChars: input.length,
    totalChars: system.length + input.length,
  };
}
