import type { AiMediaFreeLogoPlacement } from "./aiMediaFreeGenerationPrompt.ts";

/** Normalized image coordinates shared by the provider brief and final compositor. */
export type AiMediaImageLogoReservation = {
  left: number; top: number; width: number; height: number;
  horizontal: "left" | "center" | "right";
  vertical: "top" | "center" | "bottom";
};

export function resolveAiMediaImageLogoReservation(args: {
  width: number; height: number; placement?: AiMediaFreeLogoPlacement;
}): AiMediaImageLogoReservation {
  const { width, height, placement } = args;
  // Same maximum footprint as prepareLogo, including wide and tall official files.
  const logoWidth = width * (placement?.size === "large" ? 0.36 : placement?.size === "small" ? 0.13 : 0.27);
  const logoHeight = Math.min(width, height) * (placement?.size === "large" ? 0.3 : placement?.size === "small" ? 0.1 : 0.22);
  const horizontal = placement?.horizontal || "right";
  const vertical = placement?.vertical || "top";
  return {
    left: horizontal === "left" ? 0.045 : horizontal === "center" ? (1 - logoWidth / width) / 2 : 0.955 - logoWidth / width,
    top: vertical === "top" ? 0.045 : vertical === "center" ? (1 - logoHeight / height) / 2 : 0.955 - logoHeight / height,
    width: logoWidth / width, height: logoHeight / height, horizontal, vertical,
  };
}

/** Keep internal product names out of instructions that may become image pixels. */
export function buildAiMediaLocalLogoCompositionPrompt(args: {
  operation: "generate" | "modify";
  logoBrief: string;
  logoPlacement?: AiMediaFreeLogoPlacement | null;
  imageLogoReservation?: AiMediaImageLogoReservation;
}) {
  const replaceLogo = args.operation === "modify" && /\b(?:remplac|replace|corrig|correct)/i.test(args.logoBrief);
  const zone = args.imageLogoReservation;
  const percent = (fraction: number) => Math.round(fraction * 1_000) / 10;
  return [
    "Le fichier réel du logo du Profil sera ajouté séparément après la génération. Ne pas dessiner, imiter, réinterpréter ni inventer de logo.",
    replaceLogo ? "Retirer l'ancien logo ou le faux logo visé par la retouche, reconstruire proprement son fond et ne pas le redessiner." : "",
    zone
      ? `ZONE RÉSERVÉE AU LOGO FINAL : de x=${percent(Math.max(0, zone.left - 0.02))} % à x=${percent(Math.min(1, zone.left + zone.width + 0.02))} %, et de y=${percent(Math.max(0, zone.top - 0.02))} % à y=${percent(Math.min(1, zone.top + zone.height + 0.02))} % du cadre. Y prolonger seulement le fond naturel ; aucun texte, lettre, prix, coordonnée, titre, accroche, pictogramme ou sujet essentiel dans cette zone. Placer tous les textes demandés à l'extérieur avec une marge de respiration. Ne dessiner ni logo provisoire, ni cadre, ni aplat, ni emplacement visible. Cette réserve sert uniquement au montage et reste prioritaire sur la mise en page du texte.`
      : args.logoPlacement
      ? "Conserver une zone dégagée à la position demandée pour le logo dans le brief."
      : "Préserver des espaces de respiration cohérents avec la composition pour l'ajout du logo, sans imposer un coin particulier ni masquer le sujet.",
    "Conserver les autres textes et éléments non visés par la demande.",
  ].filter(Boolean).join(" ");
}
