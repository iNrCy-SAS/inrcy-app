"use client";

import { useCallback, useEffect, useState } from "react";
import { normalizeAiMediaImageEngine, normalizeAiMediaVideoEngine, type AiMediaImageEngine, type AiMediaVideoEngine } from "@/lib/aiMediaModelCatalog";

type Preference = {
  videoEngine: AiMediaVideoEngine;
  imageEngine: AiMediaImageEngine;
  videoResolution: "720p" | "768p" | "1080p";
};
const DEFAULT: Preference = { videoEngine: "omni", imageEngine: "openai", videoResolution: "720p" };

/** The account key prevents a saved model from following another establishment. */
export default function useMediaEnginePreference(accountId: string | null | undefined) {
  const [stored, setStored] = useState<{ accountId: string | null; value: Preference }>({ accountId: null, value: DEFAULT });
  const value = stored.accountId === accountId ? stored.value : DEFAULT;
  useEffect(() => {
    if (!accountId) return;
    let next = DEFAULT;
    try {
      const parsed = JSON.parse(localStorage.getItem(`inrcy:media-engines:v1:${accountId}`) || "null");
      if (parsed && typeof parsed === "object") next = {
        videoEngine: normalizeAiMediaVideoEngine(parsed.videoEngine) || "omni",
        imageEngine: normalizeAiMediaImageEngine(parsed.imageEngine) ?? "openai",
        videoResolution: ["720p", "768p", "1080p"].includes(parsed.videoResolution) ? parsed.videoResolution : "720p",
      };
    } catch { /* The generator still works when browser storage is disabled. */ }
    setStored({ accountId, value: next });
  }, [accountId]);
  const update = useCallback((patch: Partial<Preference>) => {
    if (!accountId) return;
    const next = { ...value, ...patch };
    try { localStorage.setItem(`inrcy:media-engines:v1:${accountId}`, JSON.stringify(next)); } catch { /* Session state remains available. */ }
    setStored({ accountId, value: next });
  }, [accountId, value]);
  return { ...value, update };
}
