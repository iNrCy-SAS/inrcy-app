"use client";
import { getClientUserFacingErrorMessage as getSafeClientErrorMessage } from "@/lib/userFacingErrors";
import { useTranslations } from "next-intl";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import type { ChannelBubbleRenderer } from "../../_components/channel-bubble.types";

type Snapshot = { accountId: string; enabled: boolean; visible: boolean; allowed: boolean; profileReady: boolean; companyName: string; city: string; profession: string; badgeUrl: string; warning?: string };

export default function InrDirectorySettingsContent({ renderBubble, initialEnabled = null }: { renderBubble: ChannelBubbleRenderer; initialEnabled?: boolean | null }) {
  const t = useTranslations("settings");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const saving = useRef(false);
  const enabled = snapshot?.visible ?? initialEnabled === true;

  const emit = useCallback((next: Snapshot) => {
    window.dispatchEvent(new CustomEvent("inrcy:inr-directory-settings-updated", { detail: { accountId: next.accountId, directoryEnabled: next.visible } }));
  }, []);

  useEffect(() => {
    alive.current = true;
    const accountId = getActiveBrowserUserId();
    const controller = new AbortController();
    void fetch("/api/inr-directory/settings", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const next = await response.json();
        if (!response.ok || !next.ok) throw new Error(getSafeClientErrorMessage({ ...next, status: response.status }, t("errors_directory_unavailable")));
        if (!alive.current || accountId !== getActiveBrowserUserId() || next.accountId !== accountId) return;
        setSnapshot(next); emit(next);
      }).catch(caught => { if (!controller.signal.aborted && alive.current) setError(getSafeClientErrorMessage(caught, t("errors_directory_load"))); })
      .finally(() => { if (alive.current && !controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; controller.abort(); };
  }, [emit, t]);

  const save = async (nextEnabled: boolean) => {
    if (saving.current || !snapshot) return;
    const accountId = getActiveBrowserUserId();
    if (snapshot.accountId !== accountId) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inr-directory/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: nextEnabled, accountId }) });
      const next = await response.json();
      if (!response.ok || !next.ok) throw new Error(getSafeClientErrorMessage({ ...next, status: response.status }, t("errors_directory_save")));
      if (!alive.current || accountId !== getActiveBrowserUserId() || next.accountId !== accountId) return;
      setSnapshot(next); emit(next);
      setNotice(next.warning ? getSafeClientErrorMessage(next.warning, t("directory_access_help")) : t(next.visible ? "directory_listed_notice" : "directory_removed_notice"));
    } catch (caught) { if (alive.current && accountId === getActiveBrowserUserId()) setError(getSafeClientErrorMessage(caught, t("errors_directory_save"))); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };

  const availability = snapshot && !snapshot.profileReady
    ? t("directory_profile_help")
    : snapshot && !snapshot.allowed ? t("directory_access_help") : "";
  return renderBubble({ accountConnected: snapshot?.enabled ?? enabled, resourceLabel: snapshot?.companyName || t("directory_company_fallback"), loading, busy: busy || loading,
    error, notice: notice || availability, connectLabel: t("directory_activate"), disconnectLabel: t("directory_deactivate"), onConnect: () => save(true), onDisconnect: () => save(false) });
}
