import "server-only";

import { type BoosterChannels, type BoosterRecentPublication, type BoosterTheme } from "@/lib/boosterPrompt";
import { decodeBusinessSector } from "@/lib/activitySectors";
import { findJobValueByLabel, getJobLabel, getJobsForSector, isValidJobForSector } from "@/lib/activityCatalog";
import { type InrAgentChannel, type InrAgentTheme, type InrAgentTone, type InrAgentValidationMode } from "@/lib/inrAgentSettings";
import { INR_AGENT_IMAGES_PER_PUBLICATION, type InrAgentEditorialMediaKind, type InrAgentEditorialSlot } from "@/lib/inrAgentEditorialPlanning";
import { normalizeInrAgentEditorialFocus, type InrAgentEditorialFocus } from "@/lib/inrAgentEditorialVariation";
import { type JsonRecord, type ChannelPost, type ImageBankAsset } from "@/lib/inrAgentPublicationPreparationTypes";

export const agentThemeToBoosterTheme: Partial<Record<InrAgentTheme, BoosterTheme>> = {
  conseils: "conseil",
  realisations: "realisation",
  offres: "promotion",
  actualites: "actualite",
  coulisses: "realisation",
  temoignages: "avis_client",
  services: "information",
  faq: "conseil",
  recrutement: "actualite",
};

export const themeLabels: Partial<Record<InrAgentTheme, string>> = {
  conseils: "Conseil",
  realisations: "Réalisation",
  offres: "Offre",
  actualites: "Actualité",
  coulisses: "Coulisses",
  temoignages: "Avis client",
  services: "Service",
  faq: "Question fréquente",
  recrutement: "Recrutement",
};

export const agentToneInstructions: Record<InrAgentTone, string> = {
  professional:
    "Ton professionnel, clair et crédible, sans jargon inutile ni emphase artificielle.",
  friendly:
    "Ton accessible, chaleureux et naturel, tout en restant professionnel.",
  premium:
    "Ton premium, sobre et confiant, avec une formulation élégante sans superlatifs creux.",
  local:
    "Ton local et proche du terrain, valorisant la proximité sans inventer de lieu ni de fait.",
  dynamic:
    "Ton dynamique, direct et rythmé, avec une accroche forte mais jamais agressive.",
};

const channelLabels: Record<string, string> = {
  site_web: "Site web",
  inr_search: "iNr'Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  threads: "Threads",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
  x: "X",
};

export const allowedBoosterChannels = new Set<BoosterChannels>([
  "site_web",
  "inr_search",
  "gmb",
  "facebook",
  "instagram",
  "threads",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "x",
]);

const mediaRequiredChannels = new Set<BoosterChannels>([
  "instagram",
  "tiktok",
  "youtube_shorts",
  "pinterest",
]);

function channelRequiresVideo(channel: BoosterChannels) {
  return channel === "youtube_shorts";
}

export function channelMediaReadiness(
  channel: BoosterChannels,
  media: ImageBankAsset | null
) {
  const mediaKind = media?.mediaType || media?.kind || "image";

  if (channelRequiresVideo(channel) && mediaKind !== "video") {
    return {
      ready: false,
      publishable: false,
      status: "blocked",
      label: "Bloquant",
      reason: "YouTube nécessite une vidéo.",
      blockers: ["YouTube nécessite une vidéo."],
      warnings: [] as string[],
      canPublishTextOnly: false,
    };
  }

  if (mediaRequiredChannels.has(channel) && !media) {
    const reason =
      channel === "instagram"
        ? "Instagram nécessite au moins 1 image ou 1 vidéo."
        : channel === "pinterest"
        ? "Pinterest nécessite une image ou une vidéo."
        : "TikTok nécessite au moins 1 photo ou 1 vidéo.";
    return {
      ready: false,
      publishable: false,
      status: "blocked",
      label: "Bloquant",
      reason,
      blockers: [reason],
      warnings: [] as string[],
      canPublishTextOnly: false,
    };
  }

  const warnings = !media
    ? channel === "gmb"
      ? ["Google Business sera publié sans photo ni vidéo."]
      : ["Aucun média sélectionné."]
    : [];

  return {
    ready: true,
    publishable: true,
    status: media
      ? mediaKind === "video"
        ? "ready_with_video"
        : "ready_with_image"
      : "ready_text_only",
    label: "Prêt",
    reason: media
      ? mediaKind === "video"
        ? "Prêt à publier avec une vidéo."
        : "Prêt à publier avec une image."
      : "Prêt à publier en texte seul.",
    blockers: [] as string[],
    warnings,
    canPublishTextOnly: !media,
  };
}

export function cleanText(value: unknown, maxLength = 220) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function cleanLongContext(value: unknown, maxLength = 4_200) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength)
    .trim();
}

export function cleanList(value: unknown, maxItems = 8, maxItemLength = 80) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,;\n]/)
        .map((item) => item.trim());

  return Array.from(
    new Set(
      rawItems.map((item) => cleanText(item, maxItemLength)).filter(Boolean)
    )
  ).slice(0, maxItems);
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function normalizeAgentTone(value: unknown): InrAgentTone {
  const tone = cleanText(value, 40) as InrAgentTone;
  return Object.hasOwn(agentToneInstructions, tone) ? tone : "professional";
}

export function normalizeEditorialPlan(
  value: unknown
): (InrAgentEditorialSlot & { timezone?: string; state?: string }) | null {
  const record = asRecord(value);
  const slotKey = cleanText(record.slotKey, 240);
  const scheduledFor = cleanText(record.scheduledFor, 80);
  const scheduledAt = Date.parse(scheduledFor);
  const mediaKind = cleanText(
    record.mediaKind,
    20
  ) as InrAgentEditorialMediaKind;
  const theme = cleanText(record.theme, 80) as InrAgentTheme;
  const focus = normalizeInrAgentEditorialFocus(record.focus);
  if (
    !slotKey ||
    !Number.isFinite(scheduledAt) ||
    !["image", "video", "existing"].includes(mediaKind)
  ) {
    return null;
  }
  const channels = (Array.isArray(record.channels) ? record.channels : [])
    .map((channel) => cleanText(channel, 80) as InrAgentChannel)
    .filter(Boolean);
  return {
    slotKey,
    scheduledFor: new Date(scheduledAt).toISOString(),
    sequence: Math.max(1, Math.round(Number(record.sequence) || 1)),
    totalSlots: Math.max(1, Math.round(Number(record.totalSlots) || 1)),
    theme,
    tone: normalizeAgentTone(record.tone),
    mediaKind,
    imageCount: mediaKind === "image" ? (record.imageCount === 3 ? 3 : INR_AGENT_IMAGES_PER_PUBLICATION) : 0,
    ...(record.videoDurationSeconds === 8 ? { videoDurationSeconds: 8 as const } : {}),
    channels,
    scheduleSignature: cleanText(record.scheduleSignature, 2_000),
    criteriaSignature: cleanText(record.criteriaSignature, 2_000),
    ...(focus ? { focus } : {}),
    timezone: cleanText(record.timezone, 100) || undefined,
    state: cleanText(record.state, 40) || undefined,
  };
}

export function chooseTheme(
  allowedThemes: InrAgentTheme[],
  recentPublications: BoosterRecentPublication[]
): InrAgentTheme {
  const publishThemes = allowedThemes.filter((theme) =>
    Boolean(agentThemeToBoosterTheme[theme])
  );
  if (!publishThemes.length) return "conseils";
  const patterns: Partial<Record<InrAgentTheme, RegExp>> = {
    conseils:
      /\b(conseil|astuce|guide|recommand|comment|bon geste|erreur a eviter)\b/i,
    realisations:
      /\b(realisation|chantier|projet|intervention|avant apres|resultat|coulisses)\b/i,
    offres:
      /\b(offre|promotion|service|prestation|devis|reservation|decouvr|profitez)\b/i,
    actualites:
      /\b(actualite|nouveaute|saison|evenement|information|agenda|lancement)\b/i,
    coulisses:
      /\b(coulisse|equipe|atelier|quotidien|methode|savoir faire|organisation)\b/i,
    temoignages:
      /\b(avis|temoignage|client|satisfaction|confiance|recommand)\b/i,
    services:
      /\b(service|prestation|solution|accompagnement|expertise|metier)\b/i,
    faq: /\b(question|reponse|faq|pourquoi|comment|combien|delai)\b/i,
    recrutement:
      /\b(recrut|poste|candidat|emploi|equipe|embauche|rejoindre)\b/i,
  };
  const normalizedHistory = recentPublications
    .slice(0, 5)
    .map((publication) =>
      normalizeCatalogText(
        [publication.title, publication.idea, publication.content]
          .filter(Boolean)
          .join(" ")
      )
    );
  const scored = publishThemes.map((theme, themeIndex) => {
    const pattern = patterns[theme];
    const repetitionScore = normalizedHistory.reduce(
      (total, text, historyIndex) =>
        total + (pattern?.test(text) ? Math.max(1, 6 - historyIndex) : 0),
      0
    );
    return { theme, repetitionScore, themeIndex };
  });
  scored.sort(
    (a, b) =>
      a.repetitionScore - b.repetitionScore || a.themeIndex - b.themeIndex
  );
  return scored[0]?.theme || "conseils";
}

function normalizeCatalogText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeCatalogSlug(value: unknown) {
  return normalizeCatalogText(value).replace(/\s+/g, "_");
}

function resolveKnownJobValue(sector: string, rawJob: unknown) {
  const candidate = cleanText(rawJob, 180);
  if (!sector || sector === "autre" || !candidate) return "";
  if (isValidJobForSector(sector, candidate)) return candidate;

  const exactLabelMatch = findJobValueByLabel(sector, candidate);
  if (exactLabelMatch) return exactLabelMatch;

  const normalizedCandidate = normalizeCatalogText(candidate);
  const slugCandidate = normalizeCatalogSlug(candidate);
  const jobs = getJobsForSector(sector);

  for (const job of jobs) {
    if (
      job.value === candidate ||
      job.value === slugCandidate ||
      normalizeCatalogText(job.value) === normalizedCandidate ||
      normalizeCatalogText(job.label) === normalizedCandidate
    ) {
      return job.value;
    }
  }

  for (const job of jobs) {
    const normalizedLabel = normalizeCatalogText(job.label);
    const normalizedValue = normalizeCatalogText(job.value);
    if (
      normalizedCandidate &&
      (normalizedLabel.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedLabel) ||
        normalizedValue.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedValue))
    ) {
      return job.value;
    }
  }

  return "";
}

export function getBusinessProfession(business: JsonRecord | null) {
  const decoded = decodeBusinessSector(String(business?.sector || ""));
  const rawProfessionCandidates = [
    decoded.profession,
    business?.profession,
    business?.profession_label,
    business?.professionLabel,
    business?.job,
    business?.job_label,
    business?.jobLabel,
    business?.activity,
    business?.activity_label,
    business?.activityLabel,
  ];

  const profession =
    rawProfessionCandidates
      .map((candidate) =>
        resolveKnownJobValue(decoded.sectorCategory, candidate)
      )
      .find(Boolean) || "";

  const professionLabel =
    (profession ? getJobLabel(decoded.sectorCategory, profession) : "") ||
    cleanText(decoded.profession, 180) ||
    profession;

  return {
    sector: decoded.sectorCategory,
    profession,
    professionLabel,
    rawProfession: cleanText(decoded.profession, 180),
  };
}

export function buildAgentIdea(args: {
  business: JsonRecord | null;
  profile: JsonRecord | null;
  theme: InrAgentTheme;
  recentPublications: BoosterRecentPublication[];
  focus?: InrAgentEditorialFocus | null;
}) {
  const { sector, professionLabel } = getBusinessProfession(args.business);
  const company = cleanText(
    args.profile?.company_legal_name || args.profile?.companyLegalName || "",
    90
  );
  const city = cleanText(
    args.profile?.hq_city || args.profile?.hqCity || "",
    80
  );
  const services = cleanList(
    args.business?.services || args.business?.services_text,
    5,
    70
  );
  const zones = cleanList(
    args.business?.intervention_zones || args.business?.intervention_zones_text,
    4,
    70
  );
  const focusService = cleanText(args.focus?.service, 90);
  const focusZone = cleanText(args.focus?.zone, 90);
  const focusAudience = cleanText(args.focus?.audience, 90);
  const focusStrength = cleanText(args.focus?.strength, 110);
  const focusSpecialty = cleanText(args.focus?.specialty, 90);
  const focusNeed = cleanText(args.focus?.customerNeed, 100);
  const focusBusinessArgument = cleanText(args.focus?.businessArgument, 180);
  const focusHook = cleanText(args.focus?.contextualHook, 150);
  const focusSubject = cleanText(args.focus?.subject, 500);
  const servicesText = focusService
    ? ` autour de la prestation ciblée « ${focusService} »`
    : services.length
    ? ` autour de ${services.join(", ")}`
    : "";
  const cityText = city ? ` à ${city}` : "";
  const zonesText = focusZone
    ? ` dans la zone « ${focusZone} »`
    : zones.length
    ? ` et ses environs (${zones.join(", ")})`
    : "";
  const companyText = company ? ` pour ${company}` : "";
  const recentTopics = args.recentPublications
    .slice(0, 3)
    .map((publication) =>
      cleanText(publication.title || publication.idea || "", 90)
    )
    .filter(Boolean);
  const freshnessInstruction = recentTopics.length
    ? ` Choisir un angle nettement différent de ces sujets récents : ${recentTopics.join(
        " ; "
      )}.`
    : "";
  const focusFacts = [
    focusService ? `prestation : ${focusService}` : "",
    focusSpecialty ? `spécialité : ${focusSpecialty}` : "",
    focusZone ? `zone : ${focusZone}` : "",
    focusAudience ? `public : ${focusAudience}` : "",
    focusStrength ? `force à valoriser : ${focusStrength}` : "",
    focusNeed ? `besoin client : ${focusNeed}` : "",
    focusBusinessArgument
      ? `argument ou preuve vérifiée à développer : ${focusBusinessArgument}`
      : "",
    focusHook ? `repère d'actualité à traiter factuellement : ${focusHook}` : "",
    args.focus?.angle
      ? `angle éditorial : ${args.focus.angle.replaceAll("_", " ")}`
      : "",
  ].filter(Boolean);
  const editorialFocusInstruction = focusSubject
    ? `\n\nFOCUS ÉDITORIAL PLANIFIÉ — PRIORITÉ ABSOLUE : traite le sujet « ${focusSubject} » et non une autre prestation par défaut.${focusFacts.length ? ` Appuie-toi sur ces informations vérifiées : ${focusFacts.join(" ; ")}.` : ""}${args.focus?.mediaDirection ? ` La direction du média doit rester cohérente : ${args.focus.mediaDirection}` : ""}`
    : "";
  const continuityInstruction = `${editorialFocusInstruction}${freshnessInstruction}`;

  if (args.theme === "realisations") {
    return `Préparer une publication de type réalisation${companyText} : mettre en avant le sérieux, la méthode et le soin apporté par un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText}, sans inventer de faux chantier ni de faux client.${continuityInstruction}`;
  }

  if (args.theme === "offres") {
    return `Préparer une publication commerciale douce${companyText} : valoriser une prestation utile d'un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText}, avec un appel à l'action naturel, sans inventer de remise, de prix ou de promesse.${continuityInstruction}`;
  }

  if (args.theme === "actualites") {
    return `Préparer une publication d'actualité locale${companyText} pour un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText} : parler d'un sujet utile ou saisonnier en lien avec l'activité, sans inventer d'événement précis.${continuityInstruction}`;
  }

  if (args.theme === "coulisses") {
    return `Préparer une publication dans les coulisses${companyText} pour un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText} : expliquer une méthode, une étape de travail, un geste métier ou l'organisation quotidienne de façon humaine et concrète, sans inventer d'équipe, de lieu, de matériel ni d'intervention.${continuityInstruction}`;
  }

  if (args.theme === "temoignages") {
    return `Préparer une publication de preuve sociale${companyText} pour un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText} : valoriser la confiance et la satisfaction uniquement à partir des éléments vérifiables fournis. Ne jamais inventer de client, de citation, de note, de chiffre ni de témoignage ; si aucun avis précis n'est fourni, parler de l'importance des retours clients ou inviter naturellement à consulter ou partager un avis.${continuityInstruction}`;
  }

  if (args.theme === "services") {
    return `Préparer une publication de présentation de service${companyText} pour un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText} : expliquer clairement un service réellement renseigné, son utilité et à qui il s'adresse, avec un appel à l'action naturel, sans inventer de prix, de délai, de garantie ni de promesse.${continuityInstruction}`;
  }

  if (args.theme === "faq") {
    return `Préparer une publication de type question fréquente${companyText} pour un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText} : répondre simplement à une vraie question générale que les clients peuvent se poser sur ce métier, sans inventer de règle, de tarif, de délai ni de condition propre à l'entreprise.${continuityInstruction}`;
  }

  if (args.theme === "recrutement") {
    return `Préparer une publication autour du recrutement ou de la marque employeur${companyText} pour un professionnel ${
      professionLabel || sector
    }${servicesText}${cityText}${zonesText}. Ne jamais annoncer un poste, un contrat, un salaire, un avantage ou une embauche sans information explicite fournie ; à défaut, présenter les valeurs, les savoir-faire ou les métiers de l'entreprise sans faire croire qu'une offre est ouverte.${continuityInstruction}`;
  }

  return `Préparer une publication de conseil utile${companyText} pour un professionnel ${
    professionLabel || sector
  }${servicesText}${cityText}${zonesText} : donner une astuce simple, concrète et rassurante en lien avec le métier, sans inventer de détail non fourni.${continuityInstruction}`;
}

export function getExecutionPolicy(validationMode: InrAgentValidationMode) {
  void validationMode;
  return "manual_validation";
}

export function getInitialStatus(validationMode: InrAgentValidationMode) {
  void validationMode;
  return "pending_validation";
}

export function requiresManualValidation(validationMode: InrAgentValidationMode) {
  void validationMode;
  return true;
}

export function hasUsefulContent(post: ChannelPost | undefined) {
  return Boolean(
    post?.title?.trim() || post?.content?.trim() || post?.cta?.trim()
  );
}

export function buildPreviewText(
  versions: Partial<Record<BoosterChannels, ChannelPost>>
) {
  const preferredOrder: BoosterChannels[] = [
    "facebook",
    "instagram",
    "threads",
    "gmb",
    "linkedin",
    "site_web",
    "inr_search",
    "tiktok",
    "youtube_shorts",
  ];
  const first = preferredOrder
    .map((channel) => versions[channel])
    .find(hasUsefulContent);
  if (!first) return "";
  return [first.title, first.content, first.cta].filter(Boolean).join("\n\n");
}

export function buildSummary(
  channels: BoosterChannels[],
  media: ImageBankAsset | null,
  mediaCount = media ? 1 : 0,
  autoDisabledChannels: BoosterChannels[] = []
) {
  const labels = channels
    .map((channel) => channelLabels[boosterToAgentChannel[channel]] || channel)
    .join(", ");
  const mediaSentence =
    media?.source === "ai_media_generation"
      ? media.mediaType === "video" || media.kind === "video"
        ? " Vidéo IA créée et ajoutée à la médiathèque."
        : mediaCount > 1
        ? ` ${mediaCount} visuels IA complémentaires créés et ajoutés à la médiathèque.`
        : " Visuel IA créé et ajouté à la médiathèque."
      : media
      ? media.mediaType === "video" || media.kind === "video"
        ? " Vidéo ajoutée depuis la médiathèque du pro."
        : " Visuel ajouté depuis la médiathèque ou la banque d’images."
      : " Aucun média disponible : les canaux compatibles seront préparés en texte seul.";
  const disabledChannelSentence = autoDisabledChannels.includes(
    "youtube_shorts"
  )
    ? " YouTube a été désactivé automatiquement : une vidéo est obligatoire sur ce canal."
    : "";
  return `Publication préparée pour ${labels}.${mediaSentence}${disabledChannelSentence}`;
}

export function channelMediaAdaptation(
  channel: BoosterChannels,
  media: ImageBankAsset | null
) {
  const mediaKind = media?.mediaType || media?.kind || "none";
  const channelLabel = channelLabels[boosterToAgentChannel[channel]] || channel;

  if (!media) {
    return {
      channel,
      channelLabel,
      mediaType: "none",
      strategy: "text_only",
      userEditable: false,
      note: "Aucun média à adapter pour ce canal.",
    };
  }

  if (mediaKind === "video") {
    return {
      channel,
      channelLabel,
      mediaType: "video",
      strategy: "booster_video_format",
      userEditable: true,
      note: "iNr’Agent transmet la vidéo source à Booster. Le format vidéo sera préparé selon les règles du canal avant publication.",
    };
  }

  return {
    channel,
    channelLabel,
    mediaType: "image",
    strategy: "booster_image_adapter",
    userEditable: true,
    note: "iNr’Agent transmet l’image source à Booster. Une version compatible avec le canal sera préparée sans modifier l’original.",
  };
}

export const boosterToAgentChannel: Record<BoosterChannels, string> = {
  site_web: "site_web",
  inr_search: "inr_search",
  gmb: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  threads: "threads",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
  x: "x",
};
