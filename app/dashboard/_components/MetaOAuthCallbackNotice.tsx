"use client";

import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { getMetaOAuthCallbackNotice, type MetaOAuthCallbackProvider } from "../_hooks/channels/metaOAuthCallbackNotice";
import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import StatusMessage from "./StatusMessage";

export default function MetaOAuthCallbackNotice({ provider }: { provider: MetaOAuthCallbackProvider }) {
  const query = useSearchParams();
  const language = useLocale();
  const t = useTranslations("shell");
  const { metaPilotEnabled } = useDashboardViewerAccess();
  const message = getMetaOAuthCallbackNotice(query, provider, language, t(provider === "instagram" ? "instagram_callback_error" : "threads_callback_error"));
  if (!metaPilotEnabled || !message) return null;
  return <StatusMessage variant="error">{message}</StatusMessage>;
}
