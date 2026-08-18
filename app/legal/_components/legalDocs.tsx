"use client";

import type React from "react";

import ConfidentialiteContent from "./ConfidentialiteContent";
import MentionsLegalesContent from "./MentionsLegalesContent";
import CgaContent from "./CgaContent";

export type LegalDocKey = "confidentialite" | "mentions-legales" | "cga";

export const legalDocs: Record<
  LegalDocKey,
  {
    key: LegalDocKey;
    titleKey: string;
    subtitleKey?: string;
    Content: React.ComponentType;
  }
> = {
  confidentialite: {
    key: "confidentialite",
    titleKey: "politique_de_confidentialite_42b0e51e",
    subtitleKey: "derniere_mise_a_jour_08_08_f576f6f7",
    Content: ConfidentialiteContent,
  },
  "mentions-legales": {
    key: "mentions-legales",
    titleKey: "mentions_legales_414291e0",
    subtitleKey: "derniere_mise_a_jour_08_08_f576f6f7",
    Content: MentionsLegalesContent,
  },
  cga: {
    key: "cga",
    titleKey: "cga_et_conditions_d_utilisation_353e0a8b",
    subtitleKey: "version_du_08_08_2026_1465b7bb",
    Content: CgaContent,
  },
};
