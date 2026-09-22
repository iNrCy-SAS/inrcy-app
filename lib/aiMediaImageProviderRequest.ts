import type {
  AiMediaIdentityMode,
  AiMediaInspirationImage,
  AiMediaOperation,
} from "@/lib/aiMediaGenerationContracts";

export type AiMediaImageProviderRequest = {
  accountId: string;
  prompt: string;
  operation?: AiMediaOperation;
  identityMode: AiMediaIdentityMode;
  identityReferences?: readonly Buffer[];
  referenceRoles?: ReadonlyArray<
    Pick<AiMediaInspirationImage, "role" | "usage" | "characterIndex">
  >;
  officialLogo?: Buffer | null;
  size?: `${number}x${number}`;
  signal?: AbortSignal;
};

const AI_MEDIA_IMAGE_EDIT_MAX_EDGE = 1_536;
const AI_MEDIA_IMAGE_EDIT_MIN_PIXELS = 655_360;

function positiveDimension(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

function nearestMultipleOf16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function ceilMultipleOf16(value: number) {
  return Math.max(16, Math.ceil(value / 16) * 16);
}

function clampRoundedEditRatio(width: number, height: number) {
  if (width / height > 3) {
    height = ceilMultipleOf16(width / 3);
  } else if (width / height < 1 / 3) {
    width = ceilMultipleOf16(height / 3);
  }
  return { width, height };
}

/**
 * GPT Image 2.5 accepte une résolution personnalisée, mais chaque axe doit
 * être multiple de 16 et le ratio ne peut pas dépasser 3:1. Modifier utilise
 * donc un canvas fournisseur aussi proche que possible de la source au lieu
 * de la forcer dans les anciens presets 1:1 / 2:3 / 3:2. La normalisation
 * finale conserve ensuite les dimensions exactes du fichier source.
 */
export function resolveAiMediaImageEditSize(args: {
  width: number;
  height: number;
}): `${number}x${number}` {
  const sourceWidth = positiveDimension(args.width);
  const sourceHeight = positiveDimension(args.height);
  const sourceRatio = sourceWidth / sourceHeight;
  const ratio = Math.min(3, Math.max(1 / 3, sourceRatio));
  const sourceScale = Math.min(
    1,
    AI_MEDIA_IMAGE_EDIT_MAX_EDGE / Math.max(sourceWidth, sourceHeight),
  );
  let width = sourceWidth * sourceScale;
  let height = sourceHeight * sourceScale;

  // Les ratios extrêmes sont rapprochés de la limite documentée par le
  // fournisseur tout en gardant le grand axe et le sens du canvas source.
  if (sourceRatio > 3) height = width / ratio;
  if (sourceRatio < 1 / 3) width = height * ratio;

  if (width * height < AI_MEDIA_IMAGE_EDIT_MIN_PIXELS) {
    const scale = Math.sqrt(AI_MEDIA_IMAGE_EDIT_MIN_PIXELS / (width * height));
    width *= scale;
    height *= scale;
  }

  width = nearestMultipleOf16(width);
  height = nearestMultipleOf16(height);
  ({ width, height } = clampRoundedEditRatio(width, height));

  while (width * height < AI_MEDIA_IMAGE_EDIT_MIN_PIXELS) {
    const widerRatio = (width + 16) / height;
    const tallerRatio = width / (height + 16);
    if (
      width < AI_MEDIA_IMAGE_EDIT_MAX_EDGE &&
      (height >= AI_MEDIA_IMAGE_EDIT_MAX_EDGE ||
        Math.abs(Math.log(ratio / widerRatio)) <=
          Math.abs(Math.log(ratio / tallerRatio)))
    ) {
      width += 16;
    } else if (height < AI_MEDIA_IMAGE_EDIT_MAX_EDGE) {
      height += 16;
    } else {
      break;
    }
    ({ width, height } = clampRoundedEditRatio(width, height));
  }

  return `${Math.min(AI_MEDIA_IMAGE_EDIT_MAX_EDGE, width)}x${Math.min(
    AI_MEDIA_IMAGE_EDIT_MAX_EDGE,
    height,
  )}`;
}

/**
 * Contrat immuable partagé par le moteur image nominal et son fallback.
 * Le prompt Studio compilé ne peut donc pas être réduit lors du reroutage.
 */
export function buildAiMediaImageProviderRequest(
  args: AiMediaImageProviderRequest,
): Readonly<AiMediaImageProviderRequest> {
  if (!args.prompt.trim()) throw new Error("ai_image_provider_prompt_empty");
  const identityReferences = args.identityReferences
    ? Object.freeze([...args.identityReferences])
    : undefined;
  const referenceRoles = args.referenceRoles
    ? Object.freeze(
        args.referenceRoles.map((reference) =>
          Object.freeze({ ...reference }),
        ),
      )
    : undefined;
  return Object.freeze({
    ...args,
    identityReferences,
    referenceRoles,
  });
}
