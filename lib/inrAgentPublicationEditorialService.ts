import "server-only";

import { type AiMediaSubjectSource } from "@/lib/aiMediaSubject";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type BoosterChannels, type BoosterRecentPublication, type BoosterTheme } from "@/lib/boosterPrompt";
import { normalizeInrAgentPublicationIdeas, type InrAgentAutomationSettings, type InrAgentTone } from "@/lib/inrAgentSettings";
import { generateSharedBoosterPosts, type BoosterAiImage } from "@/lib/boosterPublishGeneration";
import { type BoosterCtaDefaults } from "@/lib/boosterCtaPreferences";
import { buildInrAgentEditorialFocusPlan } from "@/lib/inrAgentEditorialVariation";
import { chooseInrAgentInstantFocusMode } from "@/lib/inrAgentInstantFocusMode";
import { wasInrAgentPublicationIdeaPreviouslyGenerated } from "@/lib/inrAgentPublicationIdeaReuse";
import { claimFirstAvailableInrAgentIdea, matchingInrAgentPublicationIdeaRow } from "@/lib/inrAgentPublicationIdeaSelection";
import { claimInrAgentPublicationIdea, loadInrAgentPublicationIdeas, releaseAbandonedInrAgentPublicationIdeas } from "@/lib/inrAgentPublicationIdeaLifecycle";
import { randomInt, randomUUID } from "node:crypto";
import { type JsonRecord, type EditorialPreparationTarget, type InrAgentPublicationPreparationContext } from "@/lib/inrAgentPublicationPreparationTypes";
import { agentThemeToBoosterTheme, agentToneInstructions, chooseTheme, getBusinessProfession, buildAgentIdea } from "@/lib/inrAgentPublicationPreparationPolicy";

export async function generateBoosterPosts(args: {
  idea: string;
  mediaSubjectSource?: AiMediaSubjectSource;
  mediaTranscriptAvailable?: boolean;
  theme: BoosterTheme;
  channels: BoosterChannels[];
  ctaDefaults: BoosterCtaDefaults;
  profile: JsonRecord | null;
  business: JsonRecord | null;
  recentPublications: BoosterRecentPublication[];
  mediaType?: "images" | "video";
  imagesForAI?: BoosterAiImage[];
  mediaContext?: string;
  accountId: string;
  agentTone: InrAgentTone;
  earlierEditorialAngles?: string[];
  skipMediaVisionAnalysis?: boolean;
}) {
  const editorialMemory = args.earlierEditorialAngles?.length
    ? `\nMémoire du mois déjà préparée (ne répète ni ces angles ni leurs accroches) :\n${args.earlierEditorialAngles.join(
        "\n"
      )}`
    : "";
  const xUrlInstruction = args.channels.includes("x")
    ? "\nRÈGLE POUR X : respecte le CTA configuré. Les liens HTTP(S) fournis sont autorisés ; n’invente aucune destination et réserve leur place dans les 280 caractères pondérés (23 caractères par URL)."
    : "";
  const { versions, recoveredChannels } = await generateSharedBoosterPosts({
    idea: args.idea,
    mediaSubjectSource: args.mediaSubjectSource,
    mediaTranscriptAvailable: args.mediaTranscriptAvailable,
    theme: args.theme,
    style: "equilibre",
    channels: args.channels,
    ctaDefaults: args.ctaDefaults,
    profile: args.profile,
    business: args.business,
    recentPublications: args.recentPublications,
    mediaType: args.mediaType || "images",
    imagesForAI: args.imagesForAI,
    forceNonBlocking: true,
    aiFeature: "agent.publish",
    accountId: args.accountId,
    skipMediaVisionAnalysis: args.skipMediaVisionAnalysis,
    mediaContext: args.mediaContext,
    extraInstructions: `CONTEXTE iNr’Agent : cette génération provient de l'automatisation Publier.
Objectif : produire exactement la même logique éditoriale que Booster / Publier manuel, avec un contenu réellement adapté à chaque canal.
TON CHOISI PAR LE PROFESSIONNEL : ${agentToneInstructions[args.agentTone]}
Ne fournis jamais des copies entre canaux. Adapte réellement l'angle, la profondeur, le vocabulaire et le rythme, sans imposer artificiellement une structure différente à chaque version.
Préserve la voix native du moteur IA choisi par l'établissement. Le titre et le contenu sont prioritaires ; un CTA séparé reste facultatif lorsqu'il serait artificiel.${xUrlInstruction}${editorialMemory}`,
  });

  return { versions, recoveredChannels };
}

/** Owns theme/focus choice and idea claims; credit reservations stay with the caller. */
export async function prepareInrAgentEditorialIdea(args: {
  context: InrAgentPublicationPreparationContext;
  editorialTarget: EditorialPreparationTarget | null;
  automation: InrAgentAutomationSettings;
  storedAgentTone: InrAgentTone;
  business: JsonRecord | null;
  profile: JsonRecord | null;
  recentPublications: BoosterRecentPublication[];
  earlierEditorialAngles: string[];
}) {
  const { editorialTarget, automation, storedAgentTone, business, profile, recentPublications, earlierEditorialAngles } = args;
  const { accountId: userId, isCron } = args.context;
  const agentTone = editorialTarget?.plan.tone || storedAgentTone;

  const businessProfession = getBusinessProfession(business);
  const plannedTheme = editorialTarget?.plan.theme;
  const agentTheme =
    plannedTheme && automation.allowedThemes.includes(plannedTheme)
      ? plannedTheme
      : chooseTheme(automation.allowedThemes, recentPublications);
  const boosterTheme = agentThemeToBoosterTheme[agentTheme] || "conseil";
  const publicationIdeas = normalizeInrAgentPublicationIdeas(
    automation.metadata?.publicationIdeas
  ).filter(Boolean);
  await releaseAbandonedInrAgentPublicationIdeas({ supabase: supabaseAdmin, userId });
  const ideaRows = await loadInrAgentPublicationIdeas({
    supabase: supabaseAdmin,
    userId,
    publicationIdeas,
  });
  const instantActionId = editorialTarget ? null : randomUUID();
  let reservedInstantIdea = false;
  const historicalSubjects = [
    ...recentPublications.flatMap((publication) => [
      publication.title,
      publication.idea,
      publication.content,
    ]),
    ...earlierEditorialAngles,
  ];
  // Chaque action planifiée garde le focus de son créneau. Un éclair manuel
  // tire soit une idée disponible, soit un sujet libre guidé par l'iNr'ADN.
  const buildInstantFocus = (availableIdeas: string[]) =>
    buildInrAgentEditorialFocusPlan({
      slots: [
        {
          slotKey:
            editorialTarget?.plan.slotKey ||
            `instant:${userId}:${agentTheme}:${recentPublications[0]?.created_at || "first"}`,
          sequence:
            editorialTarget?.plan.sequence || recentPublications.length + 1,
          theme: agentTheme,
        },
      ],
      business,
      profile,
      publicationIdeas: availableIdeas,
      allowPreviouslyCoveredPublicationIdeas: true,
      historicalSubjects,
      seed: `${userId}:inr-agent-instant`,
    })[0]?.focus || null;
  const prefersExistingMedia = automation.useImageBank && automation.preferredMediaSource !== "ai_generation";
  let runtimeFocus = prefersExistingMedia ? null : editorialTarget?.plan.focus || null;
  if (editorialTarget && runtimeFocus?.source === "professional_idea") {
    const ideaRow = matchingInrAgentPublicationIdeaRow(ideaRows, runtimeFocus.subject);
    const previouslyGenerated = wasInrAgentPublicationIdeaPreviouslyGenerated({
      payload: editorialTarget.payload,
      metadata: editorialTarget.metadata,
      ideaText: runtimeFocus.subject,
    }) || (ideaRow && wasInrAgentPublicationIdeaPreviouslyGenerated({
      payload: editorialTarget.payload,
      metadata: editorialTarget.metadata,
      ideaText: ideaRow.idea_text,
    }));
    const reserved = previouslyGenerated ||
      (ideaRow?.status === "used" && ideaRow.used_action_id === editorialTarget.id) ||
      (ideaRow?.status === "active" && await claimInrAgentPublicationIdea({
      supabase: supabaseAdmin,
      userId,
      ideaText: ideaRow?.idea_text || runtimeFocus.subject,
      actionId: editorialTarget.id,
      }));
    if (!reserved) {
      return { ok: false as const, code: "INR_AGENT_IDEA_UNAVAILABLE" as const };
    }
    if (ideaRow) runtimeFocus = { ...runtimeFocus, subject: ideaRow.idea_text };
  }
  if (!editorialTarget && instantActionId) {
    const availableIdeaRows = ideaRows
      .filter((row) => row.status === "active" && !row.reserved_action_id);
    // Les lancements automatiques sans créneau conservent leur priorité
    // historique aux idées ; seul le bouton éclair effectue ce tirage 50/50.
    const focusMode = isCron
      ? "saved_idea"
      : chooseInrAgentInstantFocusMode(availableIdeaRows.length, randomInt(2));
    if (focusMode === "saved_idea" && !prefersExistingMedia) {
      const claimedFocus = await claimFirstAvailableInrAgentIdea({
        rows: availableIdeaRows,
        buildFocus: buildInstantFocus,
        claim: (ideaText) => claimInrAgentPublicationIdea({
          supabase: supabaseAdmin,
          userId,
          ideaText,
          actionId: instantActionId,
        }),
      });
      if (claimedFocus) {
        runtimeFocus = claimedFocus;
        reservedInstantIdea = true;
      }
    }
    runtimeFocus ||= buildInstantFocus([]);
  }
  const baseIdea = buildAgentIdea({
    business,
    profile,
    theme: agentTheme,
    recentPublications,
    focus: runtimeFocus,
  });
  const guidedIdea = runtimeFocus?.source === "professional_idea"
    ? `IDÉE PRIORITAIRE FOURNIE PAR LE PROFESSIONNEL : ${runtimeFocus.subject}\n\n${baseIdea}`
    : baseIdea;
  const idea = editorialTarget
    ? `${guidedIdea}\n\nPLAN ÉDITORIAL : publication ${editorialTarget.plan.sequence}/${editorialTarget.plan.totalSlots} du mois glissant, prévue le ${editorialTarget.plan.scheduledFor}. Choisis un angle concret distinct des autres publications du mois, tout en respectant strictement le thème et les informations vérifiées du profil.`
    : guidedIdea;
  return { ok: true as const, agentTone, businessProfession, agentTheme, boosterTheme, instantActionId, reservedInstantIdea, runtimeFocus, idea };
}
