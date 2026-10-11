"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { detectClientBillingPlatform } from "@/lib/clientSubscriptionBilling";
import { VIDEO_CREDIT_PACKS, isStripeCheckoutUrl } from "@/lib/boutique/videoCreditPacks";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import styles from "./VideoCreditRecharge.module.css";

type PackState = { key: string; available: boolean };
type Order = { id: string; pack_key: string; request_key: string; seconds: number; amount_ht_cents: number; status: string; granted_at: string | null; revoked_seconds: number; held_seconds: number; dispute_revoked_seconds: number; created_at: string };
type Catalogue = { accountId: string; actorAuthUserId: string; canPurchase: boolean; packs: PackState[]; orders: Order[] };

function storageKey(accountId: string, actorId: string, packKey: string) { return `inrcy:video-credit-checkout:v1:${accountId}:${actorId}:${packKey}`; }

export function VideoCreditBalance() {
  const t = useTranslations("settings");
  const [balance, setBalance] = useState<{ included: number; purchased: number; remaining: number; debt: number; held: number } | null>(null);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      setBalance(null);
      const response = await fetch("/api/media-generation/quota", { cache: "no-store" }).catch(() => null);
      const data = response?.ok ? await response.json().catch(() => null) : null;
      if (!active || request !== sequence || !data?.quota || data.quota.unlimited) return;
      const video = data.quota.video;
      if (typeof video?.remaining === "number") setBalance({ included: video.includedRemaining ?? video.remaining,
        purchased: video.purchasedRemaining ?? 0, remaining: video.remaining, debt: video.purchasedDebt ?? 0, held: video.purchasedHeld ?? 0 });
    };
    void load();
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, load);
    window.addEventListener("focus", load);
    return () => { active = false; sequence++; window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, load); window.removeEventListener("focus", load); };
  }, []);
  return balance ? <p className={styles.balance} role="status">
    <strong>{t("video_credit_available", { seconds: balance.remaining })}</strong>
    <span>{t("video_credit_breakdown", { included: balance.included, purchased: balance.purchased })}</span>
    {balance.debt > 0 ? <span>{t("video_credit_debt", { seconds: balance.debt })}</span> : null}
    {balance.held > 0 ? <span>{t("video_credit_held", { seconds: balance.held })}</span> : null}
  </p> : null;
}

export function VideoCreditPacksPanel({ onCheckoutOpened }: { onCheckoutOpened?: () => void }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const epoch = useRef(0);
  const busyRef = useRef<number | null>(null);
  const purchaseSequence = useRef(0);
  const requests = useRef(new Map<string, string>());
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const scopeEpoch = epoch.current;
    const request = ++sequence.current;
    const response = await fetch("/api/boutique/video-credits", { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (scopeEpoch !== epoch.current || request !== sequence.current) return;
    if (data?.accountId && Array.isArray(data.packs)) {
      setCatalogue(data as Catalogue);
      for (const order of (data.orders ?? []) as Order[]) {
        if (!order.granted_at && !["expired", "failed"].includes(order.status)) continue;
        const key = storageKey(data.accountId, data.actorAuthUserId, order.pack_key);
        if (requests.current.get(key) === order.request_key) requests.current.delete(key);
        try { if (sessionStorage.getItem(key) === order.request_key) sessionStorage.removeItem(key); } catch { /* Ref also fences retries. */ }
      }
    }
    else setNotice(t("video_credit_unavailable"));
  }, [t]);
  useEffect(() => {
    setWeb(detectClientBillingPlatform() === "web");
    void load();
    const changed = () => {
      epoch.current++; busyRef.current = null; setBusy(null);
      setCatalogue(null); setCheckoutUrl(null); setNotice(""); requests.current.clear(); void load();
    };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed);
    window.addEventListener("focus", load);
    return () => { epoch.current++; window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed); window.removeEventListener("focus", load); };
  }, [load]);

  const purchase = async (packKey: string) => {
    if (!web || !catalogue?.canPurchase || busyRef.current !== null) return;
    const scopeEpoch = epoch.current;
    const attempt = ++purchaseSequence.current;
    busyRef.current = attempt; setBusy(packKey); setNotice(""); setCheckoutUrl(null);
    // Open synchronously so browser popup blocking cannot discard a paid flow.
    // A separate payment tab preserves the Studio brief and media preferences.
    const paymentTab = window.open("about:blank", "_blank");
    if (paymentTab) paymentTab.opener = null;
    const key = storageKey(catalogue.accountId, catalogue.actorAuthUserId, packKey);
    let requestKey = requests.current.get(key);
    if (!requestKey) {
      try { requestKey = sessionStorage.getItem(key) ?? undefined; } catch { /* Ref remains the fallback. */ }
      requestKey ||= crypto.randomUUID();
      requests.current.set(key, requestKey);
      try { sessionStorage.setItem(key, requestKey); } catch { /* Ref prevents same-tab retries. */ }
    }
    try {
      const response = await fetch("/api/boutique/video-credits/checkout", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packKey, requestKey, accountId: catalogue.accountId }) });
      const data = await response.json().catch(() => null);
      if (scopeEpoch !== epoch.current) { paymentTab?.close(); return; }
      if (!response.ok || !data) { paymentTab?.close(); setNotice(t("video_credit_payment_error")); return; }
      if (data.expired || data.failed) {
        paymentTab?.close(); requests.current.delete(key);
        try { sessionStorage.removeItem(key); } catch { /* Stripe verified expiry/failure on the server. */ }
        setNotice(t(data.failed ? "video_credit_failed_retry" : "video_credit_expired_retry")); void load(); return;
      }
      if (data.pending) { paymentTab?.close(); setNotice(t("video_credit_pending")); onCheckoutOpened?.(); return; }
      if (data.completed) {
        paymentTab?.close(); requests.current.delete(key);
        try { sessionStorage.removeItem(key); } catch { /* No credit is granted on the client. */ }
        setNotice(t("video_credit_confirmed")); void load(); onCheckoutOpened?.(); return;
      }
      if (!isStripeCheckoutUrl(data.url)) throw new Error("invalid_checkout_url");
      setCheckoutUrl(data.url);
      if (paymentTab) paymentTab.location.href = data.url;
      setNotice(t("video_credit_payment_opened")); onCheckoutOpened?.();
    } catch { paymentTab?.close(); if (scopeEpoch === epoch.current) setNotice(t("video_credit_payment_error")); }
    finally {
      if (busyRef.current === attempt) {
        busyRef.current = null;
        if (scopeEpoch === epoch.current) setBusy(null);
      }
    }
  };
  return <section className={styles.panel} aria-label={t("video_credit_title")}>
    <h2>{t("video_credit_title")}</h2>
    <p>{t("video_credit_description")}</p>
    <VideoCreditBalance />
    {web ? <div className={styles.grid}>
      {VIDEO_CREDIT_PACKS.map((pack) => <article key={pack.key} className={styles.pack}>
        <strong>{pack.seconds} s</strong>
        <span>{new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(pack.priceEurHt)} {t("standard_tax_exclusive_short")}</span>
        <button type="button" disabled={busy !== null || !catalogue?.canPurchase || !catalogue.packs.find((p) => p.key === pack.key)?.available}
          aria-label={`${t("video_credit_buy")} ${pack.seconds} s, ${new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(pack.priceEurHt)} ${t("standard_tax_exclusive_short")}`}
          onClick={() => void purchase(pack.key)}>{busy === pack.key ? t("video_credit_opening") : t("video_credit_buy")}</button>
      </article>)}
    </div> : <p>{t("video_credit_native_unavailable")}</p>}
    {web && catalogue && !catalogue.canPurchase ? <p>{t("video_credit_admin_required")}</p> : null}
    {web && catalogue && !catalogue.packs.some((pack) => pack.available) ? <p>{t("video_credit_unavailable")}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {checkoutUrl ? <a className={styles.checkoutLink} href={checkoutUrl} target="_blank" rel="noopener noreferrer">{t("video_credit_continue")}</a> : null}
    <p className={styles.note}>{t("video_credit_tax_note")}</p>
    {catalogue?.orders?.length ? <details className={styles.history}>
      <summary>{t("video_credit_history")}</summary>
      {catalogue.orders.map((order) => <p key={order.id}><strong>{order.seconds} s</strong>
        <span>{new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(order.created_at))}</span>
        <span>{t(order.status === "refunded" ? "video_credit_refunded" : order.status === "failed" ? "video_credit_failed" : order.status === "expired" ? "video_credit_expired" : order.held_seconds > 0 ? "video_credit_disputed" : order.dispute_revoked_seconds > 0 ? "video_credit_dispute_lost" : order.revoked_seconds > 0 ? "video_credit_partially_refunded" : order.granted_at ? "video_credit_paid" : "video_credit_pending")}</span>
      </p>)}
    </details> : null}
  </section>;
}

export function VideoCreditRechargeButton({ disabled = false, onRefresh }: { disabled?: boolean; onRefresh?: () => void }) {
  const t = useTranslations("settings");
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [web, setWeb] = useState(false);
  const openedCheckout = useRef(false);
  useEffect(() => { setWeb(detectClientBillingPlatform() === "web"); }, []);
  useEffect(() => {
    const refresh = () => { if (openedCheckout.current) onRefresh?.(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [onRefresh]);
  if (!web) return null;
  return <>
    <button type="button" className={styles.recharge} disabled={disabled} onClick={() => dialog.current?.showModal()}>{t("video_credit_recharge")}</button>
    {createPortal(<dialog className={styles.dialog} ref={dialog} aria-labelledby={titleId} onClose={onRefresh}>
      <header><h2 id={titleId}>{t("video_credit_recharge")}</h2>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label={t("video_credit_close")}>×</button></header>
      <VideoCreditPacksPanel onCheckoutOpened={() => { openedCheckout.current = true; }} />
    </dialog>, document.body)}
  </>;
}
