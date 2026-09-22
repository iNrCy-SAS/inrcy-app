import {
  AI_MEDIA_FORMAT_SPECS,
  type AiMediaGenerationRequest,
  type AiMediaKind,
} from "@/lib/aiMediaGenerationContracts";

export function getAiMediaPromptOutputSpec(
  value: AiMediaGenerationRequest | AiMediaKind
) {
  if (typeof value === "string") {
    return value === "image"
      ? {
          format: "square",
          aspectRatio: "1:1",
          width: 1080,
          height: 1080,
          quality: "medium",
        }
      : {
          format: "square",
          aspectRatio: "1:1",
          width: 1080,
          height: 1080,
          durationSeconds: 16,
          quality: "hd",
        };
  }

  const format = AI_MEDIA_FORMAT_SPECS[value.format];
  const isModification = value.operation === "modify";
  const width = isModification
    ? value.modificationSourceWidth || format.width
    : format.width;
  const height = isModification
    ? value.modificationSourceHeight || format.height
    : format.height;
  return {
    format: value.format,
    aspectRatio: isModification ? `${width}:${height}` : format.aspectRatio,
    width,
    height,
    canvasMode: isModification ? "source" : "preset",
    durationSeconds: value.kind === "video" ? value.durationSeconds : null,
    sceneMode: value.kind === "video" ? value.sceneMode || "single" : null,
    connectScenes: value.kind === "video" && value.connectScenes === true,
    quality: "hd",
    typology: value.typology,
    visualStyle: value.visualStyle,
    imageStyle: value.imageStyle,
    shotType: value.shotType,
    peopleMode: value.peopleMode,
    creativity: value.creativity,
    textMode: value.textMode || (value.withText ? "ai" : "none"),
    useBrandColors: value.useBrandColors,
    logoMode: value.logoMode,
    videoEngine: value.kind === "video" ? value.videoEngine : null,
    identityMode: value.identityMode,
    videoCharacterMode:
      value.kind === "video" ? value.videoCharacterMode : null,
  };
}
