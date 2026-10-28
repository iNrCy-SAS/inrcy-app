"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import styles from "./AgentMediaImage.module.css";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  src: string;
  alt: string;
  accountId?: string | null;
  sourceKey: string;
  compact?: boolean;
  recoverUrl?: (signal: AbortSignal) => Promise<string | null>;
};

function internalRetryUrl(src: string, attempt: number) {
  try {
    const url = new URL(src, window.location.href);
    if (url.origin !== window.location.origin || !(url.pathname === "/api/storage/content" || /^\/api\/media-library\/items\/[a-f\d-]+\/content$/i.test(url.pathname))) return null;
    url.searchParams.set("previewRetry", `${Date.now()}-${attempt}`);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}

function ImageAttempt({ src, alt, accountId, sourceKey: _sourceKey, compact = false, recoverUrl, ...imageProps }: Props) {
  const t = useTranslations("media");
  const [requestedSrc, setRequestedSrc] = useState(src);
  const [failed, setFailed] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [scopeLost, setScopeLost] = useState(false);
  const automaticRetryUsed = useRef(false);
  const attempts = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const scope = useRef(accountId || getActiveBrowserUserId());
  const current = () => mounted.current && Boolean(scope.current) && scope.current === getActiveBrowserUserId();

  useEffect(() => {
    mounted.current = true;
    const accountChanged = () => {
      if (scope.current === getActiveBrowserUserId()) return;
      pending.current?.abort(); setScopeLost(true);
    };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, accountChanged);
    return () => { mounted.current = false; pending.current?.abort(); window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, accountChanged); };
  }, []);

  async function retry(manual: boolean) {
    if (!current() || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setRecovering(true);
    try {
      const fresh = await recoverUrl?.(controller.signal).catch(() => null);
      if (!current() || controller.signal.aborted) return;
      const next = internalRetryUrl(fresh || src, ++attempts.current);
      if (!next && !manual) { setFailed(true); return; }
      setRequestedSrc(next || src); setFailed(false);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (mounted.current && !controller.signal.aborted) setRecovering(false);
    }
  }

  if (scopeLost) return null;
  if (recovering && !failed) return <span className={compact ? styles.compact : styles.unavailable} role={compact ? undefined : "status"} aria-hidden={compact ? true : undefined}>
    {compact ? "…" : t("chargement_01cba1df")}
  </span>;
  if (failed) return <span className={compact ? styles.compact : styles.unavailable} role={compact ? undefined : "status"}
    aria-hidden={compact ? true : undefined} title={t("apercu_indisponible_d0ce704a")}>
    <span aria-hidden="true">▧</span>
    {!compact ? <><span>{t("apercu_indisponible_d0ce704a")}</span>
      <button type="button" disabled={recovering} onClick={() => { void retry(true); }}>{t("ai_generator_retry")}</button></> : null}
  </span>;
  return <img {...imageProps} alt={alt} src={requestedSrc} onError={() => {
    if (!current()) { setScopeLost(true); return; }
    if (!automaticRetryUsed.current && (recoverUrl || internalRetryUrl(src, 0))) {
      automaticRetryUsed.current = true; void retry(false);
    } else { setFailed(true); }
  }} />;
}

/** Isolate recovery to this preview; never refresh or replace the editable action. */
export default function AgentMediaImage(props: Props) {
  return <ImageAttempt key={`${props.accountId}:${props.sourceKey}:${props.src}`} {...props} />;
}
