"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import type { NativeChannelKey, NativeChannelStates } from "@/lib/nativeChannelActivation";
import type { InrBadgeProfileSummary } from "@/lib/inrBadge";
import { getInrDirectoryUrl } from "@/lib/inrDirectorySettings";
import type { ChannelBubbleRenderer } from "../../_components/channel-bubble.types";
import { InrBadgeQrButton, InrBadgeCopyButton, InrBadgeDownloadButton } from "../../_components/InrBadgeBubbleActions";
import { readNativeChannelSnapshot, type NativeChannelSnapshot } from "../../_components/native-channel-state";
import styles from "../../_components/DashboardChannelBubble.module.css";
import local from "./NativeChannelSettingsContent.module.css";

type Props = {
  channelKey: NativeChannelKey; renderBubble: ChannelBubbleRenderer;
  initialStates?: NativeChannelStates | null; companyName?: string;
  badgeProfile: InrBadgeProfileSummary; badgeParameters?: ReactNode;
};

export default function NativeChannelSettingsContent({ channelKey, renderBubble, initialStates, companyName, badgeProfile, badgeParameters }: Props) {
  const t = useTranslations("dashboard.nativeChannels");
  const bubble = useTranslations("dashboard.channelBubble");
  const [snapshot, setSnapshot] = useState<NativeChannelSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const saving = useRef(false);
  const emit = useCallback((next: NativeChannelSnapshot) => {
    window.dispatchEvent(new CustomEvent("inrcy:native-channels-settings-updated", { detail: next }));
  }, []);
  useEffect(() => {
    mounted.current = true;
    const accountId = getActiveBrowserUserId();
    const controller = new AbortController();
    void fetch("/api/native-channels/settings", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async response => {
        const raw = await response.json();
        if (!response.ok || !raw.ok) throw new Error(t("loadFailed"));
        if (!mounted.current || accountId !== getActiveBrowserUserId()) return;
        const next = readNativeChannelSnapshot(raw, accountId);
        if (!next) throw new Error(t("loadFailed"));
        setSnapshot(next); emit(next);
      }).catch(() => { if (mounted.current && !controller.signal.aborted && accountId === getActiveBrowserUserId()) setError(t("loadFailed")); })
      .finally(() => { if (mounted.current && !controller.signal.aborted && accountId === getActiveBrowserUserId()) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [emit, t]);

  const save = async (enabled: boolean) => {
    if (saving.current || !snapshot) return;
    const accountId = getActiveBrowserUserId();
    if (snapshot.accountId !== accountId) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/native-channels/settings", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, key: channelKey, enabled }) });
      const raw = await response.json();
      if (!response.ok || !raw.ok) throw new Error(t("saveFailed"));
      if (!mounted.current || accountId !== getActiveBrowserUserId()) return;
      const next = readNativeChannelSnapshot(raw, accountId);
      if (!next) throw new Error(t("saveFailed"));
      setSnapshot(next); emit(next);
      window.dispatchEvent(new CustomEvent("inrcy:channel-connection-updated", { detail: { channel: channelKey, accountId } }));
    } catch { if (mounted.current && accountId === getActiveBrowserUserId()) setError(t("saveFailed")); }
    finally { saving.current = false; if (mounted.current && accountId === getActiveBrowserUserId()) setBusy(false); }
  };
  const state = snapshot?.states[channelKey] || initialStates?.[channelKey];
  const published = state?.published === true;
  const publicUrl = !published ? "" : channelKey === "inrbadge" ? snapshot?.badgeUrl || "" : channelKey === "inr_directory" ? getInrDirectoryUrl() : snapshot?.searchSlug ? `${window.location.origin}/entreprises/${encodeURIComponent(snapshot.searchSlug)}` : "";
  const name = snapshot?.companyName || companyName || t("yourCompany");
  const disabled = loading || busy || !snapshot || !state?.allowed;
  const pending = state?.pending === true;
  return renderBubble({
    accountConnected: state?.requested === true, resourceLabel: name, loading, busy,
    status: published ? "connected" : "available", statusText: published ? t("published") : state?.pending ? t("pending") : t("inactive"),
    publicView: { href: publicUrl, disabled: !published || !publicUrl },
    resourceContent: <div className={`${styles.resourceGroup} ${pending ? local.pending : ""}`} data-native-channel-pending={pending || undefined}>
      {!pending ? <span className={styles.accountValue} title={name}>{name}</span> : null}
      {pending ? <div className={local.details} role="status">
        <strong className={local.waitingStatus}>{t("pending")}</strong>
      </div> : null}
      <div className={pending ? local.actions : undefined}>
        <button type="button" className={`${styles.action} ${pending ? local.deactivate : ""}`} disabled={disabled} aria-busy={busy || loading} onClick={() => void save(!state?.requested)}>{loading ? bubble("loading") : t(state?.requested ? "deactivate" : "activate")}</button>
      </div>
    </div>,
    extraActions: <><InrBadgeQrButton publicUrl={publicUrl} companyName={name} compact /><InrBadgeDownloadButton publicUrl={publicUrl} profile={{ ...badgeProfile, companyLegalName: name }} /><InrBadgeCopyButton publicUrl={publicUrl} onNotice={setNotice} onError={setError} /></>,
    afterContent: <>{notice ? <p className={local.notice} role="status">{notice}</p> : null}{state && !state.allowed ? <p className={local.notice}>{t("unavailable")}</p> : null}</>,
    error, parameters: channelKey === "inrbadge" && published ? badgeParameters : undefined, parametersFullScreen: true,
  });
}
