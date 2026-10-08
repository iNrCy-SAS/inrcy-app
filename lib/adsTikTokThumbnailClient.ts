import { ownedPreparedVideoId } from "./adsPreparedNativeClient.ts";
/** First decoded frame from an owned, same-origin video. It is stored privately by the caller. */
export async function prepareOwnedTikTokThumbnail(url: string, signal: AbortSignal): Promise<{ file: File; width: number; height: number; videoMediaId: string }> {
  const videoMediaId = ownedPreparedVideoId(url);
  if (!videoMediaId) throw new Error("La vidéo TikTok doit être enregistrée dans votre médiathèque iNrCy.");
  if (signal.aborted) throw new DOMException("Annulé", "AbortError");
  const video = document.createElement("video");
  video.preload = "auto"; video.muted = true; video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); video.removeEventListener("loadeddata", ready); video.removeEventListener("error", failed); signal.removeEventListener("abort", aborted); };
      const ready = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(new Error("La miniature n’a pas pu être extraite de cette vidéo.")); };
      const aborted = () => { clean(); reject(new DOMException("Annulé", "AbortError")); };
      const timer = setTimeout(failed, 30_000);
      video.addEventListener("loadeddata", ready); video.addEventListener("error", failed); signal.addEventListener("abort", aborted, { once: true });
      video.src = url; video.load();
    });
    if (signal.aborted) throw new DOMException("Annulé", "AbortError");
    const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight;
    const scale = Math.min(1, 1080 / sourceWidth, 1920 / sourceHeight);
    const width = Math.floor(sourceWidth * scale), height = Math.floor(sourceHeight * scale);
    if (!width || !height || width > 7680 || height > 7680) throw new Error("Le format de cette vidéo ne permet pas de préparer sa miniature.");
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("La préparation de la miniature est indisponible dans ce navigateur.");
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("La miniature vidéo n’a pas pu être préparée.")), "image/jpeg", 0.9));
    if (signal.aborted) throw new DOMException("Annulé", "AbortError");
    return { file: new File([blob], `tiktok-${videoMediaId}.jpg`, { type: "image/jpeg" }), width, height, videoMediaId };
  } finally { video.pause(); video.removeAttribute("src"); video.load(); }
}
