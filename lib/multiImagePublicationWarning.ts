export const PARTIAL_IMAGES_WARNING_CODE =
  "published_with_partial_images" as const;
export const NO_IMAGE_WARNING_CODE = "published_without_image" as const;

export type ImagePublicationWarning = {
  code:
    | typeof PARTIAL_IMAGES_WARNING_CODE
    | typeof NO_IMAGE_WARNING_CODE;
  kind: "media_degraded";
  message: string;
  expectedCount: number;
  publishedCount: number;
};

function normalizeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function photoLabel(count: number) {
  return `photo${count > 1 ? "s" : ""}`;
}

/**
 * Shared warning contract for every provider that accepts several photos.
 * A successful publication stays successful, while the exact degradation is
 * persisted for Booster and iNr'Send instead of silently dropping media.
 */
export function getImagePublicationWarning(params: {
  channelLabel: string;
  expectedCount: number;
  publishedCount: number;
  constraintMessage?: string | null;
}): ImagePublicationWarning | null {
  const expectedCount = normalizeCount(params.expectedCount);
  const publishedCount = normalizeCount(params.publishedCount);
  if (expectedCount === 0 || publishedCount >= expectedCount) return null;

  const channelLabel = String(params.channelLabel || "Le canal").trim();
  const constraintMessage = String(params.constraintMessage || "").trim();

  if (publishedCount === 0) {
    return {
      code: NO_IMAGE_WARNING_CODE,
      kind: "media_degraded",
      message: [
        `${channelLabel} a publié le texte, mais aucune des ${expectedCount} ${photoLabel(expectedCount)} n’a pu être jointe.`,
        constraintMessage,
      ]
        .filter(Boolean)
        .join(" "),
      expectedCount,
      publishedCount,
    };
  }

  const missingCount = expectedCount - publishedCount;
  const missingVerb = missingCount > 1 ? "n’ont" : "n’a";
  const missingAgreement = missingCount > 1 ? "jointes" : "jointe";
  return {
    code: PARTIAL_IMAGES_WARNING_CODE,
    kind: "media_degraded",
    message: [
      `${channelLabel} a publié ${publishedCount} ${photoLabel(publishedCount)} sur ${expectedCount}. ${missingCount} ${photoLabel(missingCount)} ${missingVerb} pas pu être ${missingAgreement}.`,
      constraintMessage,
    ]
      .filter(Boolean)
      .join(" "),
    expectedCount,
    publishedCount,
  };
}
