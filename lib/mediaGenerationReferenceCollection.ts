import { AI_MEDIA_INSPIRATION_MAX_COUNT } from "./aiMediaGenerationContracts.ts";
import type { MediaGenerationInspirationImage, MediaGenerationReferenceRole } from "./mediaGenerationClientRequest.ts";

export type StudioReferenceImage = MediaGenerationInspirationImage & {
  usage: "required" | "inspiration";
  clientReferenceId?: string;
};

export function normalizeCharacterReferenceIndexes(images: StudioReferenceImage[]) {
  let characterIndex = 0;
  return images.map((image) => {
    if (image.role !== "character") {
      const withoutCharacterIndex = { ...image };
      delete withoutCharacterIndex.characterIndex;
      delete withoutCharacterIndex.voiceMode;
      delete withoutCharacterIndex.voiceSample;
      return withoutCharacterIndex;
    }
    characterIndex += 1;
    if (characterIndex > 3) {
      const withoutCharacterIndex = { ...image };
      delete withoutCharacterIndex.characterIndex;
      return withoutCharacterIndex;
    }
    return { ...image, characterIndex: characterIndex as 1 | 2 | 3 };
  });
}

function orderReferences(images: StudioReferenceImage[]) {
  return [...images].sort((left, right) => {
    const rank = (image: StudioReferenceImage) =>
      image.role === "character"
        ? image.characterIndex || 1
        : image.role === "environment"
        ? 4
        : image.role === "inspiration"
        ? 4.5
        : 5;
    return rank(left) - rank(right);
  });
}

export function insertStudioReference(
  current: StudioReferenceImage[],
  next: StudioReferenceImage,
  role: MediaGenerationReferenceRole,
  characterIndex: 1 | 2 | 3 | undefined,
  insertion: "replace" | "append",
) {
  const retained = insertion === "append"
    ? current
    : current.filter((image) => !(image.role === role &&
      (role !== "character" || image.characterIndex === characterIndex)));
  return normalizeCharacterReferenceIndexes(
    orderReferences([...retained, next]).slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT),
  );
}
