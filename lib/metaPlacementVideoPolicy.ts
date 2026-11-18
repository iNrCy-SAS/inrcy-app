export type MetaPlacementVideoIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type MetaPlacementVideoInput = {
  channel: "facebook" | "instagram";
  placement: "classic" | "reel" | "story";
  durationSeconds?: unknown;
  width?: unknown;
  height?: unknown;
  frameRate?: unknown;
  sizeBytes?: unknown;
  /** Output ratio selected in the editor; prepared media uses `original`. */
  format?: string;
};

function finiteMetadata(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/**
 * Placement-specific checks shared by the editor and the final media preflight.
 * Source dimensions/FPS are provisional when an explicit adaptation is pending;
 * the server must call this again with the actual output and format="original".
 * Classic posts retain their existing channel validation.
 *
 * https://developers.facebook.com/documentation/video-api/page-stories-api
 * https://developers.facebook.com/documentation/video-api/guides/reels-publishing
 * https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
 */
export function getMetaPlacementVideoIssues(input: MetaPlacementVideoInput): MetaPlacementVideoIssue[] {
  if (input.placement === "classic" || (input.channel === "instagram" && input.placement === "reel")) return [];

  const label = `${input.channel === "facebook" ? "Facebook" : "Instagram"} — ${input.placement === "story" ? "Story" : "Reel"}`;
  const prefix = `${input.channel}_${input.placement}_video`;
  const issues: MetaPlacementVideoIssue[] = [];
  const add = (suffix: string, message: string, severity: MetaPlacementVideoIssue["severity"] = "error") => {
    issues.push({ code: `${prefix}_${suffix}`, message: `${label} : ${message}`, severity });
  };
  const duration = finiteMetadata(input.durationSeconds);
  const width = finiteMetadata(input.width);
  const height = finiteMetadata(input.height);
  const fps = finiteMetadata(input.frameRate);
  const size = finiteMetadata(input.sizeBytes);
  const maximumDuration = input.placement === "story" ? 60 : 90;
  const format = String(input.format || "original").trim().toLowerCase();
  const adaptationPending = ["9_16", "1_1", "16_9"].includes(format);

  if (duration === undefined) {
    add("duration_unverified", "la durée doit encore être vérifiée pendant la préparation avant l’envoi.", "warning");
  } else if (duration < 3 || duration > maximumDuration) {
    add("duration_out_of_range", duration > maximumDuration
      ? `la vidéo dure ${duration.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} s. Choisissez un extrait de 3 à ${maximumDuration} s pour ce format.`
      : `la vidéo doit durer au moins 3 s. Choisissez un extrait de 3 à ${maximumDuration} s.`);
  }

  if (input.channel === "facebook") {
    // The selected output ratio is already known even before rendering.
    if (adaptationPending && format !== "9_16") {
      add("aspect_ratio", "ce format exige une vidéo verticale 9:16. Choisissez l’adaptation 9:16 pour cette destination.");
    } else if (width === undefined || height === undefined || width <= 0 || height <= 0) {
      add("dimensions_unverified", "les dimensions et le format vertical 9:16 doivent encore être vérifiés pendant la préparation.", "warning");
    } else {
      if (width < 540 || height < 960) {
        add("resolution", adaptationPending
          ? "la vidéo source est inférieure à 540 × 960 px. L’adaptation 9:16 doit préparer une vidéo d’au moins 540 × 960 px, qui sera vérifiée avant l’envoi."
          : "la vidéo est inférieure à 540 × 960 px. Adaptez-la en 9:16 à au moins 540 × 960 px avant l’envoi.", adaptationPending ? "warning" : "error");
      }
      // Allow at most one pixel of rounding in the encoded height.
      if (Math.abs(width * 16 - height * 9) > 9) {
        add("aspect_ratio", adaptationPending
          ? "la vidéo source n’est pas au format 9:16. L’adaptation sélectionnée sera vérifiée avant l’envoi."
          : "la vidéo doit être au format vertical 9:16. Choisissez l’adaptation 9:16 pour cette destination.", adaptationPending ? "warning" : "error");
      }
    }
    if (fps === undefined || fps <= 0) {
      add("frame_rate_unverified", "la cadence doit encore être vérifiée : 24 à 60 images/s sont nécessaires.", "warning");
    } else if (fps < 24 || fps > 60) {
      add("frame_rate", adaptationPending
        ? "la cadence source est hors de la plage 24–60 images/s. L’adaptation devra la corriger avant la vérification finale."
        : "la vidéo doit avoir une cadence de 24 à 60 images/s. Adaptez ou réexportez la vidéo avant l’envoi.", adaptationPending ? "warning" : "error");
    }
  } else {
    if (fps === undefined || fps <= 0) {
      add("frame_rate_unverified", "la cadence doit encore être vérifiée : 23 à 60 images/s sont nécessaires.", "warning");
    } else if (fps < 23 || fps > 60) {
      add("frame_rate", adaptationPending
        ? "la cadence source est hors de la plage 23–60 images/s. L’adaptation devra la corriger avant la vérification finale."
        : "la vidéo doit avoir une cadence de 23 à 60 images/s. Adaptez ou réexportez la vidéo avant l’envoi.", adaptationPending ? "warning" : "error");
    }
    if (size === undefined || size <= 0) {
      add("size_unverified", "la taille du fichier doit encore être vérifiée avant l’envoi (100 Mo maximum).", "warning");
    } else if (size > 100 * 1024 * 1024) {
      add("size", "la vidéo dépasse 100 Mo. Compressez l’extrait destiné à la Story avant l’envoi.");
    }
    if (width === undefined || height === undefined || width <= 0 || height <= 0) {
      add("dimensions_unverified", "les dimensions doivent encore être vérifiées. Le format vertical 9:16 est conseillé.", "warning");
    } else {
      if (width > 1920 && !adaptationPending) add("width", "la largeur dépasse 1920 px. Adaptez la vidéo avant l’envoi.");
      const ratio = width / height;
      if ((ratio < 0.1 || ratio > 10) && !adaptationPending) {
        add("aspect_ratio", "le rapport largeur/hauteur doit être compris entre 0,1:1 et 10:1. Choisissez l’adaptation 9:16.");
      } else if (format !== "9_16" && Math.abs(width * 16 - height * 9) > 9) {
        add("vertical_recommended", "le format vertical 9:16 est conseillé pour éviter le recadrage ou les bandes. Vous pouvez sélectionner l’adaptation 9:16.", "warning");
      }
    }
  }
  return issues;
}
