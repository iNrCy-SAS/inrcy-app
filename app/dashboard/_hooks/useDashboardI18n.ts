"use client";

import { useMemo } from "react";
import { useLocale, useMessages } from "next-intl";

import type { DashboardCopy } from "@/i18n/dashboard";

export function useDashboardI18n() {
  const locale = useLocale();
  const messages = useMessages();

  return useMemo(
    () => ({ ...messages.dashboard, locale }) as DashboardCopy,
    [locale, messages.dashboard],
  );
}
