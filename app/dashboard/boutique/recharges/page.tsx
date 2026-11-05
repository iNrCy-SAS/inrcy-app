"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { VideoCreditPacksPanel } from "@/app/dashboard/_components/VideoCreditRecharge";
import DashboardToolHeading from "@/app/dashboard/_components/DashboardToolHeading";
import { useDashboardViewerAccess } from "@/app/dashboard/_components/DashboardViewerAccessProvider";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";

function Recharges() {
  const t = useTranslations("settings");
  const params = useSearchParams();
  const { activeAccountId, actorUserId } = useDashboardViewerAccess();
  const orderId = params.get("order");
  const mediaKind = params.get("media") === "image" ? "image" : "video";
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const expectedAccountId = getActiveBrowserUserId() || activeAccountId;
    const current = () => active && Boolean(actorUserId && activeAccountId && expectedAccountId === activeAccountId) && (getActiveBrowserUserId() || activeAccountId) === expectedAccountId;
    setNotice("");
    if (params.get("checkout") !== "success" || !orderId || !current()) return;
    const guard = new URLSearchParams({ expectedAccountId, expectedActorUserId: actorUserId });
    fetch(`/api/boutique/${mediaKind}-credits/orders/${encodeURIComponent(orderId)}?${guard}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (current()) setNotice(t(response.ok && data.order?.id === orderId && data.order?.granted === true
          ? mediaKind === "image" ? "image_credit_confirmed" : "video_credit_confirmed"
          : "video_credit_pending"));
      }).catch(() => { if (current()) setNotice(t("video_credit_pending")); });
    return () => { active = false; };
  }, [orderId, mediaKind, params, refresh, t, activeAccountId, actorUserId]);
  return <main style={{ width: "min(100%,1000px)", margin: "0 auto", padding: "24px 16px", boxSizing: "border-box" }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
      <DashboardToolHeading subtitle={t("video_credit_description")}>
        <h1 style={{ margin: 0, fontSize: 20, lineHeight: 1.2 }}>{t("media_credit_recharge_title")}</h1>
      </DashboardToolHeading>
      <Link href="/dashboard/generer-media">← iNr’Studio</Link>
    </header>
    {notice ? <p role="status">{notice} <button type="button" onClick={() => setRefresh((n) => n+1)}>{t("video_credit_refresh")}</button></p> : null}
    <VideoCreditPacksPanel key={`media-${refresh}`} />
  </main>;
}
export default function VideoCreditRechargePage() {
  return <Suspense><Recharges /></Suspense>;
}
