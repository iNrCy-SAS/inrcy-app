"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useMediaCreditQuote from "../../_hooks/useMediaCreditQuote";
import useMediaEnginePreference from "../../_hooks/useMediaEnginePreference";
import type { MediaGenerationQuota } from "../../_hooks/useMediaGeneration";
import { getAiMediaVideoModel, isAiMediaImageModelCompatible } from "@/lib/aiMediaModelCatalog";

/** Entry checks only: Studio confirms its final quote and reserves atomically. */
export function useScheduledStudioCredits({ enabled, accountId, kind }: {
  enabled: boolean;
  accountId: string | null;
  kind: "image" | "video";
}) {
  const [state, setState] = useState<{ accountId: string | null; quota: MediaGenerationQuota | null; error: boolean }>({ accountId: null, quota: null, error: false });
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!enabled || !accountId) return;
    try {
      const response = await fetch("/api/media-generation/quota", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => null) as { quota?: MediaGenerationQuota } | null;
      if (!response.ok || payload?.quota?.accountId !== accountId) throw new Error("studio_quota_unavailable");
      if (version === requestVersion.current) setState({ accountId, quota: payload.quota, error: false });
    } catch {
      if (version === requestVersion.current) setState({ accountId, quota: null, error: true });
    }
  }, [enabled, accountId]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { requestVersion.current += 1; window.removeEventListener("focus", onFocus); };
  }, [enabled, refresh]);
  const quota = enabled && state.accountId === accountId ? state.quota : null;
  const engines = useMediaEnginePreference(quota?.accountId);
  const model = getAiMediaVideoModel(engines.videoEngine);
  const generate = useMediaCreditQuote({ kind, operation: "generate", creationMode: "free", format: kind === "video" ? "story" : "square",
    inputMode: "essential", identityMode: "auto", imageEngine: engines.imageEngine, videoEngine: engines.videoEngine,
    videoResolution: model.resolutions.includes(engines.videoResolution) ? engines.videoResolution : model.defaultResolution,
    durationSeconds: kind === "video" ? 8 : undefined, sceneMode: "single", inspirationImagesCount: 0, withNarration: false, teamVideoSpeechMode: "voiceover",
  }, quota, enabled);
  const modifyCompatible = isAiMediaImageModelCompatible({ engine: engines.imageEngine, operation: "modify", inspirationImagesCount: 1 });
  const modify = useMediaCreditQuote({ kind: "image", operation: "modify", creationMode: "guided", format: "square",
    inputMode: "essential", identityMode: "auto", imageEngine: modifyCompatible ? engines.imageEngine : "openai", inspirationImagesCount: 1,
  }, quota, enabled && kind === "image");
  const walletReady = Boolean(quota?.studioEnabled && quota.creditsReady);
  return {
    generate,
    modify,
    generateAllowed: walletReady && generate.ready && !generate.insufficient && !generate.error,
    modifyAllowed: walletReady && modify.ready && !modify.insufficient && !modify.error,
    unavailable: state.accountId === accountId && state.error || Boolean(quota && !walletReady),
    refresh,
    prepareModification: () => { if (!modifyCompatible) engines.update({ imageEngine: "openai" }); },
  };
}
