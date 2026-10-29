import type { AiMediaFreeLogoPlacement } from "./aiMediaFreeGenerationPrompt.ts";

/** Keep internal product names out of instructions that may become image pixels. */
export function buildAiMediaLocalLogoCompositionPrompt(args: {
  operation: "generate" | "modify";
  logoBrief: string;
  logoPlacement?: AiMediaFreeLogoPlacement | null;
}) {
  const replaceLogo = args.operation === "modify" && /\b(?:remplac|replace|corrig|correct)/i.test(args.logoBrief);
  return [
    "Le fichier réel du logo du Profil sera ajouté séparément après la génération. Ne pas dessiner, imiter, réinterpréter ni inventer de logo.",
    replaceLogo ? "Retirer l'ancien logo ou le faux logo visé par la retouche, reconstruire proprement son fond et ne pas le redessiner." : "",
    args.logoPlacement
      ? "Conserver une zone dégagée à la position demandée pour le logo dans le brief."
      : "Préserver des espaces de respiration cohérents avec la composition pour l'ajout du logo, sans imposer un coin particulier ni masquer le sujet.",
    "Conserver les autres textes et éléments non visés par la demande.",
  ].filter(Boolean).join(" ");
}
