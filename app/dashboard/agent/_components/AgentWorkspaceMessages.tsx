"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider, useLocale, useMessages, useTranslations, type AbstractIntlMessages } from "next-intl";
import { type InrAgentWorkspace } from "@/lib/inrAgentWorkspaces";
import { rebrandAgentMessages } from "../_lib/agent.workspace-messages";

export default function AgentWorkspaceMessages({ workspace, children }: { workspace: InrAgentWorkspace; children: ReactNode }) {
  const messages = useMessages();
  const locale = useLocale();
  const t = useTranslations("agent.workspaces");
  const label = `Agent ${t(`${workspace}.name`)}`;
  const scopedMessages = useMemo(() => ({
    ...messages,
    agent: rebrandAgentMessages(messages.agent as AbstractIntlMessages, label),
  }), [messages, label]);
  return <NextIntlClientProvider locale={locale} messages={scopedMessages}>{children}</NextIntlClientProvider>;
}
