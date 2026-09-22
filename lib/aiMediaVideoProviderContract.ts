import { createHash } from "node:crypto";

import { describeAiMediaBrandColors } from "./aiMediaColorDirection.ts";
import type {
  AiMediaGenerationRequest,
  AiMediaInspirationImage,
} from "./aiMediaGenerationContracts.ts";

export const AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION =
  "inrcy-video-provider-v1" as const;

export type AiMediaVideoProviderContract = Readonly<{
  version: typeof AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION;
  /** Sujet complet conservé pour le contexte et les plans courts. */
  subject: string;
  /** Brief utilisateur autoritaire, jamais résumé ni tronqué silencieusement. */
  instruction: string;
  /** Toutes les options structurées visibles dans le Studio. */
  parameters: string;
  /** Inventaire et politique de fidélité de chaque média transmis au moteur. */
  references: string;
  /** Empreinte du contenu ci-dessus, vérifiée avant tout appel réseau payant. */
  sha256: string;
}>;

type ReferenceDescriptor = Pick<
  AiMediaInspirationImage,
  "role" | "usage" | "characterIndex"
>;

function clean(value: unknown, max: number) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length > max) {
    throw new Error(`ai_video_instruction_contract_too_long:${normalized.length}:${max}`);
  }
  return normalized;
}

/**
 * Conserve la consigne ponctuelle distincte du sujet. Un sujet custom reste
 * intégral comme repli si l'UI n'a pas rempli `aiInstruction` : auparavant il
 * était réduit à un extrait d'environ 190 caractères dans le provider vidéo.
 * Le sujet complet voyage déjà dans `contract.subject`, donc le recopier ici
 * gaspillerait le budget fournisseur sans ajouter d'information.
 */
export function buildAiMediaVideoProviderInstruction(
  request: AiMediaGenerationRequest,
) {
  const subject = clean(request.idea, 2_000);
  const instruction = clean(request.aiInstruction, 2_400);
  return instruction || subject;
}

function normalizedReference(
  reference: ReferenceDescriptor,
  index: number,
  request: AiMediaGenerationRequest,
) {
  const strictIdentity = request.identityMode !== "auto";
  const role = reference.role || (strictIdentity ? "character" : "inspiration");
  const usage =
    reference.usage ||
    (strictIdentity && role === "character" ? "required" : "inspiration");
  const character = reference.characterIndex
    ? `/character-${reference.characterIndex}`
    : "";
  return {
    role,
    usage,
    character,
    inventory: `#${index + 1}:${role}/${usage}${character}`,
  };
}

export function buildAiMediaVideoReferenceContract(args: {
  request: AiMediaGenerationRequest;
  identityTeamPrecomposed?: boolean;
  identityTeamMemberCount?: 2 | 3;
}) {
  const references = args.request.inspirationImages.map((reference, index) =>
    normalizedReference(reference, index, args.request),
  );
  if (!references.length) return "none; create an original scene";
  const inventory = references.map((reference) => reference.inventory).join(",");
  const requiredRoles = Array.from(
    new Set(
      references
        .filter((reference) => reference.usage === "required")
        .map((reference) => reference.role),
    ),
  );
  const inspirationRoles = Array.from(
    new Set(
      references
        .filter((reference) => reference.usage === "inspiration")
        .map((reference) => reference.role),
    ),
  );
  const policies = [
    requiredRoles.includes("character")
      ? "required characters: preserve every distinct adult identity exactly once; no merge/omit/duplicate/swap"
      : "",
    requiredRoles.includes("product")
      ? "required products: preserve exact shape/material/distinctive details and integrate naturally"
      : "",
    requiredRoles.includes("environment")
      ? "required environments: preserve recognizable place/layout/ambience as the scene"
      : "",
    requiredRoles.includes("inspiration")
      ? "required uncategorized media: preserve every brief-relevant recognizable element"
      : "",
    inspirationRoles.length
      ? `inspiration-only ${inspirationRoles.join("/")}: guide mood/style/composition only; never copy identity, product, place, pose or framing exactly`
      : "",
  ].filter(Boolean);

  if (args.request.identityMode === "reference_team") {
    policies.unshift(
      `group=${
        args.identityTeamMemberCount === 3 ? 3 : 2
      } adults, each once; identities locked; all move 0.0s; no merge/omit/duplicate/swap`,
    );
  } else if (args.request.identityMode === "professional") {
    policies.unshift(
      "all distinct approved adults visible in required character refs; each once; same face/hair/build each act; motion 0.0s",
    );
  } else if (args.request.identityMode === "brand_avatar") {
    policies.unshift(
      "approved brand avatar: same design/features each act; real motion at 0.0s",
    );
  }
  if (args.identityTeamPrecomposed) {
    policies.unshift(
      "the supplied file is the single sanitized master composition, never the original separate portraits",
    );
  }
  return `files=${inventory}; ${policies.join("; ")}`;
}

/**
 * Contrat dense de toutes les options Studio. Le texte exact et le logo ne
 * sont volontairement jamais envoyés au moteur visuel : ils sont composés
 * localement, sans risque de faute ni de fuite dans le décor généré.
 */
export function buildAiMediaVideoParameterContract(args: {
  request: AiMediaGenerationRequest;
  durationSeconds: 4 | 6 | 8;
  brandColors: readonly string[];
}) {
  const { request } = args;
  const palette = request.useBrandColors
    ? describeAiMediaBrandColors(args.brandColors).join("/") || "subject-led"
    : "subject-led";
  const sceneMode =
    request.sceneMode || (request.connectScenes ? "single" : "multi");
  const textMode = request.textMode || (request.withText ? "ai" : "none");
  const audioMode =
    request.teamVideoSpeechMode === "characters"
      ? "characters"
      : request.withNarration
        ? `voiceover-${request.narrationVoice || "female"}-${
            request.narrationVoiceVariant || "default"
          }`
        : "silent";
  return [
    `film=${request.durationSeconds || args.durationSeconds}s`,
    `fmt=${request.format}`,
    `type=${request.typology}`,
    `mode=${request.generationMode || "ai_free"}`,
    `crit=${request.peopleCriterion || "auto"}/${
      request.settingCriterion || "auto"
    }/${request.focusCriterion || "auto"}`,
    `dir=${request.visualDirection || "auto"}`,
    `look=${request.visualStyle}/${request.imageStyle}/${request.shotType}/${
      request.peopleMode
    }/${request.creativity}`,
    `story=${sceneMode}/${request.connectScenes ? "linked" : "unlinked"}`,
    `text=${textMode}/local`,
    `audio=${audioMode}/${request.withMusic ? "music" : "no-music"}`,
    `id=${request.identityMode}/${request.teamVideoMode}`,
    `logo=${request.logoMode}/local`,
    `pal=${palette}`,
  ].join(";");
}

function serializeContract(
  contract: Omit<AiMediaVideoProviderContract, "sha256">,
) {
  return [
    contract.version,
    contract.subject,
    contract.instruction,
    contract.parameters,
    contract.references,
  ].join("\u001e");
}

export function hashAiMediaVideoProviderContract(
  contract: Omit<AiMediaVideoProviderContract, "sha256">,
) {
  return createHash("sha256").update(serializeContract(contract)).digest("hex");
}

export function buildAiMediaVideoProviderContract(args: {
  request: AiMediaGenerationRequest;
  durationSeconds: 4 | 6 | 8;
  brandColors: readonly string[];
  identityTeamPrecomposed?: boolean;
  identityTeamMemberCount?: 2 | 3;
}): AiMediaVideoProviderContract {
  const base = {
    version: AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION,
    subject: clean(args.request.idea, 2_000),
    instruction: buildAiMediaVideoProviderInstruction(args.request),
    parameters: buildAiMediaVideoParameterContract(args),
    references: buildAiMediaVideoReferenceContract(args),
  } satisfies Omit<AiMediaVideoProviderContract, "sha256">;
  return Object.freeze({
    ...base,
    sha256: hashAiMediaVideoProviderContract(base),
  });
}

export function assertAiMediaVideoProviderContract(
  contract: AiMediaVideoProviderContract,
) {
  if (contract.version !== AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION) {
    throw new Error("ai_video_provider_contract_version_invalid");
  }
  const { sha256, ...base } = contract;
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error("ai_video_provider_contract_hash_invalid");
  }
  if (hashAiMediaVideoProviderContract(base) !== sha256) {
    throw new Error("ai_video_provider_contract_integrity_failed");
  }
  if (!contract.instruction || !contract.parameters || !contract.references) {
    throw new Error("ai_video_provider_contract_incomplete");
  }
}

export function hashAiMediaCanonicalPrompt(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex");
}

export function assertAiMediaVideoProviderBoundary(args: {
  canonicalPrompt: string;
  canonicalPromptSha256: string;
  providerContract: AiMediaVideoProviderContract;
}) {
  if (!args.canonicalPrompt.trim()) {
    throw new Error("ai_video_canonical_prompt_empty");
  }
  if (
    hashAiMediaCanonicalPrompt(args.canonicalPrompt) !==
    args.canonicalPromptSha256
  ) {
    throw new Error("ai_video_canonical_prompt_integrity_failed");
  }
  assertAiMediaVideoProviderContract(args.providerContract);
}
