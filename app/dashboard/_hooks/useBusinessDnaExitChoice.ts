"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { chooseInrcy } from "@/lib/inrcyDialog";

export function useBusinessDnaExitChoice() {
  const t = useTranslations("dashboard.settingsDrawer");
  const [exitChoiceOpen, setExitChoiceOpen] = useState(false);

  const chooseExit = useCallback(async () => {
    setExitChoiceOpen(true);
    try {
      return await chooseInrcy({
        eyebrow: t("settings"),
        title: t("pendingChangesTitle"),
        message: t("pendingChangesMessage"),
        choices: [
          { value: "save", label: t("saveAndClose"), tone: "primary" },
          { value: "continue", label: t("continueEditing"), tone: "secondary" },
          { value: "discard", label: t("closeWithoutSaving"), tone: "danger" },
        ],
        defaultValue: "save",
        variant: "warning",
      });
    } finally {
      setExitChoiceOpen(false);
    }
  }, [t]);

  return { chooseExit, exitChoiceOpen };
}
