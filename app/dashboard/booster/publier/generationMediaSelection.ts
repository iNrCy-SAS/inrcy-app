export type GenerationMediaLibraryAccept = "all" | "image" | "video";

export function getGenerationMediaSelectionPolicy(params: { imageCount: number; hasVideo: boolean; maxImageCount?: number }) {
  const maxImageCount = Math.max(1, Math.floor(params.maxImageCount || 5));
  const remainingImages = Math.max(0, maxImageCount - Math.max(0, Math.floor(params.imageCount || 0)));
  const hasVideo = params.hasVideo === true;
  return {
    imagePickerDisabled: remainingImages === 0,
    videoPickerDisabled: hasVideo,
    cameraCaptureDisabled: remainingImages === 0 && hasVideo,
    allowCameraVideo: !hasVideo,
    libraryAccept: (hasVideo ? "image" : remainingImages === 0 ? "video" : "all") as GenerationMediaLibraryAccept,
    libraryMultiple: remainingImages + (hasVideo ? 0 : 1) > 1,
    libraryMaxSelection: Math.max(1, remainingImages + (hasVideo ? 0 : 1)),
  } as const;
}

export function getGenerationMediaSelectionError(params: { existingImageCount: number; hasExistingVideo: boolean; selectedImageCount: number; selectedVideoCount: number }) {
  if (params.selectedVideoCount > 1 || params.hasExistingVideo && params.selectedVideoCount > 0) return "Une seule vidéo peut être ajoutée à la génération.";
  if (Math.max(0, params.existingImageCount) + Math.max(0, params.selectedImageCount) > 5) return "Ajoutez 5 images maximum à la génération.";
  return null;
}
