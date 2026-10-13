"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { VideoCreditPacksPanel } from "@/app/dashboard/_components/VideoCreditRecharge";

function Recharges() {
  const t = useTranslations("settings");
  const params = useSearchParams();
  const orderId = params.get("order");
  const mediaKind = params.get("media") === "image" ? "image" : "video";
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setNotice("");
    if (params.get("checkout") !== "success" || !orderId) return;
    fetch(`/api/boutique/${mediaKind}-credits/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (active) setNotice(t(response.ok && data.order?.granted
          ? mediaKind === "image" ? "image_credit_confirmed" : "video_credit_confirmed"
          : "video_credit_pending"));
      }).catch(() => { if (active) setNotice(t("video_credit_pending")); });
    return () => { active = false; };
  }, [orderId, mediaKind, params, refresh, t]);
  return <main style={{ width: "min(100%,1000px)", margin: "0 auto", padding: "24px 16px", boxSizing: "border-box" }}>
    <Link href="/dashboard/generer-media">← iNr’Studio</Link>
    {notice ? <p role="status">{notice} <button type="button" onClick={() => setRefresh((n) => n+1)}>{t("video_credit_refresh")}</button></p> : null}
    <VideoCreditPacksPanel key={`media-${refresh}`} />
  </main>;
}
export default function VideoCreditRechargePage() {
  return <Suspense><Recharges /></Suspense>;
}
