"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { detectClientBillingPlatform } from "@/lib/clientSubscriptionBilling";
import { VIDEO_CREDIT_PACKS, isStripeCheckoutUrl } from "@/lib/boutique/videoCreditPacks";
import { IMAGE_CREDIT_PACKS } from "@/lib/boutique/imageCreditPacks";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import styles from "./VideoCreditRecharge.module.css";

type PackState = { key: string; available: boolean };
export type MediaCreditKind = "video" | "image";
export type MediaCreditRechargeProps = { mediaKind?: MediaCreditKind; disabled?: boolean; onRefresh?: () => void; className?: string };
type PacksPanelProps = { onCheckoutOpened?: () => void };
type Order = {
  id: string; pack_key: string; request_key: string; amount_ht_cents: number; status: string; granted_at: string | null; created_at: string;
  seconds?: number; revoked_seconds?: number; held_seconds?: number; dispute_revoked_seconds?: number;
  images?: number; revoked_images?: number; held_images?: number; dispute_revoked_images?: number;
  credits?: number;
  mediaKind?: MediaCreditKind;
  revokedCredits?: number; heldCredits?: number; disputeRevokedCredits?: number;
};
type Catalogue = { accountId: string; actorAuthUserId: string; canPurchase: boolean; packs: PackState[]; orders: Order[] };

const CREDIT_OPTIONS = {
  video: {
    endpoint: "/api/boutique/video-credits",
    packs: VIDEO_CREDIT_PACKS.map((pack) => ({ key: pack.key, quantity: pack.credits, priceEurHt: pack.priceEurHt })),
    quantityField: "seconds", revokedField: "revoked_seconds", heldField: "held_seconds", disputeRevokedField: "dispute_revoked_seconds",
    title: "video_credit_title", description: "video_credit_description", unavailable: "video_credit_unavailable", confirmed: "video_credit_confirmed",
    debt: "video_credit_debt", held: "video_credit_held",
  },
  image: {
    endpoint: "/api/boutique/image-credits",
    packs: IMAGE_CREDIT_PACKS.map((pack) => ({ key: pack.key, quantity: pack.credits, priceEurHt: pack.priceEurHt })),
    quantityField: "images", revokedField: "revoked_images", heldField: "held_images", disputeRevokedField: "dispute_revoked_images",
    title: "image_credit_title", description: "image_credit_description", unavailable: "image_credit_unavailable", confirmed: "image_credit_confirmed",
    debt: "image_credit_debt", held: "image_credit_held",
  },
} as const;

function storageKey(mediaKind: MediaCreditKind, accountId: string, actorId: string, packKey: string) {
  return `inrcy:${mediaKind}-credit-checkout:v1:${accountId}:${actorId}:${packKey}`;
}

export function VideoCreditBalance() {
  return <MediaCreditBalance mediaKind="video" />;
}

export function StudioCreditBalance() {
  return <MediaCreditBalance mediaKind="video" />;
}

export function ImageCreditBalance() {
  return <MediaCreditBalance mediaKind="image" />;
}

function MediaCreditBalance({ mediaKind, refreshKey = 0 }: { mediaKind: MediaCreditKind; refreshKey?: number }) {
  const t = useTranslations("settings");
  const [balance, setBalance] = useState<{ included: number; purchased: number; debt: number; held: number } | null>(null);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const response = await fetch("/api/media-generation/quota", { cache: "no-store" }).catch(() => null);
      const data = response?.ok ? await response.json().catch(() => null) : null;
      if (!active || request !== sequence || !data?.quota || data.quota.unlimited || !data.quota.creditsReady) return;
      const counter = data.quota.credits;
      if (typeof counter?.remaining === "number") setBalance({ included: counter.includedRemaining ?? counter.remaining,
        purchased: counter.purchasedRemaining ?? 0, debt: counter.purchasedDebt ?? 0, held: counter.purchasedHeld ?? 0 });
    };
    void load();
    const changed = () => { setBalance(null); void load(); };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed);
    return () => { active = false; sequence++; window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed); };
  }, [mediaKind, refreshKey]);
  const quantityLabel = (quantity: number) => t("media_credit_quantity", { credits: quantity });
  return balance ? <div className={styles.balance} role="status">
    <dl className={styles.balanceCounts}>
      <div><dt>{t("media_credit_included")}</dt><dd>{quantityLabel(balance.included)}</dd></div>
      <div><dt>{t("media_credit_purchased")}</dt><dd>{quantityLabel(balance.purchased)}</dd></div>
    </dl>
    {balance.debt > 0 ? <p>{t("media_credit_debt", { credits: balance.debt })}</p> : null}
    {balance.held > 0 ? <p>{t("media_credit_held", { credits: balance.held })}</p> : null}
  </div> : null;
}

export function VideoCreditPacksPanel(props: PacksPanelProps) {
  return <MediaCreditPacksPanel mediaKind="video" {...props} />;
}

export function ImageCreditPacksPanel(props: PacksPanelProps) {
  return <MediaCreditPacksPanel mediaKind="video" {...props} />;
}

function MediaCreditPacksPanel({ mediaKind, onCheckoutOpened, onBusyChange }: PacksPanelProps & { mediaKind: MediaCreditKind; onBusyChange?: (busy: boolean) => void }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const options = CREDIT_OPTIONS[mediaKind];
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const checkoutToRefresh = useRef(false);
  const epoch = useRef(0);
  const busyRef = useRef<number | null>(null);
  const purchaseSequence = useRef(0);
  const requests = useRef(new Map<string, string>());
  const sequence = useRef(0);
  useEffect(() => { onBusyChange?.(busy !== null); }, [busy, onBusyChange]);
  const load = useCallback(async () => {
    const scopeEpoch = epoch.current;
    const request = ++sequence.current;
    const response = await fetch(options.endpoint, { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (scopeEpoch !== epoch.current || request !== sequence.current) return;
    if (data?.accountId && Array.isArray(data.packs)) {
      setCatalogue(data as Catalogue);
      if (checkoutToRefresh.current && !(data.orders ?? []).some((order: Order) => !order.granted_at && !["expired", "failed", "refunded"].includes(order.status))) checkoutToRefresh.current = false;
      for (const order of (data.orders ?? []) as Order[]) {
        if (!order.granted_at && !["expired", "failed"].includes(order.status)) continue;
        const key = storageKey(order.mediaKind || mediaKind, data.accountId, data.actorAuthUserId, order.pack_key);
        if (requests.current.get(key) === order.request_key) requests.current.delete(key);
        try { if (sessionStorage.getItem(key) === order.request_key) sessionStorage.removeItem(key); } catch { /* Ref also fences retries. */ }
      }
    }
    else setNotice(t(options.unavailable));
  }, [mediaKind, options, t]);
  useEffect(() => {
    setWeb(detectClientBillingPlatform() === "web");
    void load();
    const changed = () => {
      epoch.current++; busyRef.current = null; setBusy(null);
      checkoutToRefresh.current = false;
      setCatalogue(null); setCheckoutUrl(null); setNotice(""); requests.current.clear(); void load();
    };
    const returnedFromCheckout = () => {
      if (!checkoutToRefresh.current || busyRef.current !== null) return;
      void load(); setBalanceRefresh(value => value + 1);
    };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed);
    window.addEventListener("focus", returnedFromCheckout);
    return () => { epoch.current++; window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed); window.removeEventListener("focus", returnedFromCheckout); };
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
    const key = storageKey(mediaKind, catalogue.accountId, catalogue.actorAuthUserId, packKey);
    let requestKey = requests.current.get(key);
    if (!requestKey) {
      try { requestKey = sessionStorage.getItem(key) ?? undefined; } catch { /* Ref remains the fallback. */ }
      requestKey ||= crypto.randomUUID();
      requests.current.set(key, requestKey);
      try { sessionStorage.setItem(key, requestKey); } catch { /* Ref prevents same-tab retries. */ }
    }
    try {
      const response = await fetch(`${options.endpoint}/checkout`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packKey, requestKey, accountId: catalogue.accountId }) });
      const data = await response.json().catch(() => null);
      if (scopeEpoch !== epoch.current) { paymentTab?.close(); return; }
      if (!response.ok || !data) { paymentTab?.close(); setNotice(t("video_credit_payment_error")); return; }
      if (data.expired || data.failed) {
        paymentTab?.close(); requests.current.delete(key);
        try { sessionStorage.removeItem(key); } catch { /* Stripe verified expiry/failure on the server. */ }
        setNotice(t(data.failed ? "video_credit_failed_retry" : "video_credit_expired_retry")); void load(); return;
      }
      if (data.pending) { paymentTab?.close(); checkoutToRefresh.current = true; setNotice(t("video_credit_pending")); onCheckoutOpened?.(); return; }
      if (data.completed) {
        paymentTab?.close(); requests.current.delete(key);
        try { sessionStorage.removeItem(key); } catch { /* No credit is granted on the client. */ }
        checkoutToRefresh.current = false; setBalanceRefresh(value => value + 1);
        setNotice(t(options.confirmed)); void load(); onCheckoutOpened?.(); return;
      }
      if (!isStripeCheckoutUrl(data.url)) throw new Error("invalid_checkout_url");
      setCheckoutUrl(data.url);
      checkoutToRefresh.current = true;
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
  const quantityLabel = (quantity: number) => t("media_credit_quantity", { credits: quantity });
  const currency = (price: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price);
  const referenceUnitPrice = options.packs[0].priceEurHt / options.packs[0].quantity;
  return <section className={styles.panel} aria-label={t(options.title)} aria-busy={busy !== null}>
    <h2>{t(options.title)}</h2>
    <p>{t(options.description)}</p>
    <MediaCreditBalance mediaKind={mediaKind} refreshKey={balanceRefresh} />
    {web ? <div className={styles.grid} data-kind={mediaKind}>
      {options.packs.map((pack, index) => {
        const saving = Math.max(0, Math.round((1 - pack.priceEurHt / pack.quantity / referenceUnitPrice) * 100));
        return <article key={pack.key} className={styles.pack} data-tier={index}>
          <div className={styles.packHeading}>
            <span className={styles.packSymbol} aria-hidden="true">{index === options.packs.length - 1 ? "✦" : "ϟ"}</span>
            <span className={styles.saving}>{saving > 0 ? t("media_credit_pack_saving", { percent: saving }) : t("media_credit_pack_base")}</span>
          </div>
          <strong className={styles.packQuantity}>{new Intl.NumberFormat(locale).format(pack.quantity)}</strong>
          <span className={styles.packUnit}>{t("media_credit_pack_unit")}</span>
          <div className={styles.packPrice}><span>{currency(pack.priceEurHt)}</span><small>{t("standard_tax_exclusive_short")}</small></div>
          <small className={styles.unitPrice}>{t("media_credit_pack_unit_price", { price: currency(pack.priceEurHt / pack.quantity * 1000), tax: t("standard_tax_exclusive_short"), credits: new Intl.NumberFormat(locale).format(1000) })}</small>
          <button type="button" disabled={busy !== null || !catalogue?.canPurchase || !catalogue.packs.find((p) => p.key === pack.key)?.available}
            aria-label={`${t("video_credit_buy")} ${quantityLabel(pack.quantity)}, ${new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(pack.priceEurHt)} ${t("standard_tax_exclusive_short")}`}
            onClick={() => void purchase(pack.key)}>{busy === pack.key ? t("video_credit_opening") : t("video_credit_buy")}</button>
        </article>;
      })}
    </div> : <p>{t("video_credit_native_unavailable")}</p>}
    {web && catalogue && !catalogue.canPurchase ? <p>{t("video_credit_admin_required")}</p> : null}
    {web && catalogue && !catalogue.packs.some((pack) => pack.available) ? <p>{t(options.unavailable)}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {checkoutUrl ? <a className={styles.checkoutLink} href={checkoutUrl} target="_blank" rel="noopener noreferrer">{t("video_credit_continue")}</a> : null}
    <p className={styles.note}>{t("video_credit_tax_note")}</p>
    {web ? <p className={styles.reference}>{t("media_credit_pack_reference", { credits: new Intl.NumberFormat(locale).format(options.packs[0].quantity) })}</p> : null}
    {catalogue?.orders?.length ? <details className={styles.history}>
      <summary>{t("video_credit_history")}</summary>
      {catalogue.orders.map((order) => <p key={order.id}><strong>{quantityLabel(order.credits ?? (order[options.quantityField] ?? 0) * (mediaKind === "video" ? 10 : 7))}</strong>
        <span>{new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(order.created_at))}</span>
        <span>{t(order.status === "refunded" ? "video_credit_refunded" : order.status === "failed" ? "video_credit_failed" : order.status === "expired" ? "video_credit_expired" : (order.heldCredits ?? order[options.heldField] ?? 0) > 0 ? "video_credit_disputed" : (order.disputeRevokedCredits ?? order[options.disputeRevokedField] ?? 0) > 0 ? "video_credit_dispute_lost" : (order.revokedCredits ?? order[options.revokedField] ?? 0) > 0 ? "video_credit_partially_refunded" : order.granted_at ? "video_credit_paid" : "video_credit_pending")}</span>
      </p>)}
    </details> : null}
  </section>;
}

export function MediaCreditRechargeButton({ mediaKind = "video", disabled = false, onRefresh, className }: MediaCreditRechargeProps) {
  const t = useTranslations("settings");
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [web, setWeb] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const openedCheckout = useRef(false);
  useEffect(() => { setWeb(detectClientBillingPlatform() === "web"); }, []);
  useEffect(() => {
    const refresh = () => { if (openedCheckout.current) { openedCheckout.current = false; onRefresh?.(); } };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [onRefresh]);
  if (!web) return null;
  return <>
    <button type="button" className={[styles.recharge, className].filter(Boolean).join(" ")} disabled={disabled} data-media-kind={mediaKind}
      aria-haspopup="dialog" aria-controls={`${titleId}-dialog`}
      aria-label={`${t("video_credit_recharge")} · ${t("media_credit_recharge_title")}`}
      onClick={() => { setOpen(true); dialog.current?.showModal(); }}>{t("video_credit_recharge")}</button>
    {createPortal(<dialog id={`${titleId}-dialog`} className={styles.dialog} ref={dialog} aria-labelledby={titleId}
      onCancel={event => { if (purchaseBusy) event.preventDefault(); }}
      onClose={() => { setOpen(false); setPurchaseBusy(false); onRefresh?.(); }}>
      <header><h2 id={titleId}>{t("media_credit_recharge_title")}</h2>
        <button type="button" autoFocus disabled={purchaseBusy} onClick={() => dialog.current?.close()} aria-label={t("video_credit_close")}>×</button></header>
      <div id={`${titleId}-panel`}>
        {open ? <MediaCreditPacksPanel mediaKind="video" onBusyChange={setPurchaseBusy} onCheckoutOpened={() => { openedCheckout.current = true; }} /> : null}
      </div>
    </dialog>, document.body)}
  </>;
}

export const VideoCreditRechargeButton = MediaCreditRechargeButton;
