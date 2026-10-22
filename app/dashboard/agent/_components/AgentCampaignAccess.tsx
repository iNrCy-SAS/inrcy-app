"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { INR_AGENT_WORKSPACES } from "@/lib/inrAgentWorkspaces";
import styles from "./AgentWorkspaceHeader.module.css";

export default function AgentCampaignAccess() {
  const t = useTranslations("agent.workspaces");
  return (
    <main style={{ maxWidth: 760, margin: "80px auto", padding: 24, color: "#edf4ff" }}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <img src={INR_AGENT_WORKSPACES.campaigns.icon} alt="" width={76} height={76} />
          <div><h1>Agent <span>{t("campaigns.name")}</span></h1><p>{t("campaigns.description")}</p></div>
        </div>
      </header>
      <p>{t("campaigns.premium")}</p>
      <Link href="/dashboard?panel=abonnement">{t("subscription")}</Link>
      <p><Link href="/dashboard">{t("back")}</Link></p>
    </main>
  );
}
