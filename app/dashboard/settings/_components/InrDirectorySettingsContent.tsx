"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import type { ChannelBubbleRenderer } from "../../_components/channel-bubble.types";

type Snapshot = { accountId: string; enabled: boolean; visible: boolean; allowed: boolean; profileReady: boolean; companyName: string; city: string; profession: string; badgeUrl: string; warning?: string };

export default function InrDirectorySettingsContent({ renderBubble, initialEnabled = null }: { renderBubble: ChannelBubbleRenderer; initialEnabled?: boolean | null }) {
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
        if (!response.ok || !next.ok) throw new Error(next.error || "L’annuaire est momentanément indisponible.");
        if (!alive.current || accountId !== getActiveBrowserUserId() || next.accountId !== accountId) return;
        setSnapshot(next); emit(next);
      }).catch(caught => { if (!controller.signal.aborted && alive.current) setError(caught instanceof Error ? caught.message : "Chargement impossible."); })
      .finally(() => { if (alive.current && !controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; controller.abort(); };
  }, [emit]);

  const save = async (nextEnabled: boolean) => {
    if (saving.current || !snapshot) return;
    const accountId = getActiveBrowserUserId();
    if (snapshot.accountId !== accountId) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inr-directory/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: nextEnabled, accountId }) });
      const next = await response.json();
      if (!response.ok || !next.ok) throw new Error(next.error || "L’enregistrement a échoué.");
      if (!alive.current || accountId !== getActiveBrowserUserId() || next.accountId !== accountId) return;
      setSnapshot(next); emit(next);
      setNotice(next.warning || (next.visible ? "Votre fiche figure dans l’annuaire." : "Votre fiche a été retirée de l’annuaire."));
    } catch (caught) { if (alive.current && accountId === getActiveBrowserUserId()) setError(caught instanceof Error ? caught.message : "L’enregistrement a échoué."); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };

  const availability = snapshot && !snapshot.profileReady
    ? "Complétez le nom de votre entreprise, votre ville et votre métier dans votre profil et votre ADN."
    : snapshot && !snapshot.allowed ? "Vérifiez vos accès à l’annuaire, à iNr’Badge et votre abonnement." : "";
  return renderBubble({ accountConnected: snapshot?.enabled ?? enabled, resourceLabel: snapshot?.companyName || "Votre entreprise", loading, busy: busy || loading,
    error, notice: notice || availability, connectLabel: "Activer", disconnectLabel: "Désactiver", onConnect: () => save(true), onDisconnect: () => save(false) });
}
