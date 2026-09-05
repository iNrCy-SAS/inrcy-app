"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  normalizeAiMediaGeneratorPreferences,
  type AiMediaGeneratorBlockDefaults,
  type AiMediaGeneratorPreferenceBlockId,
  type AiMediaGeneratorPreferences,
} from "@/lib/aiMediaGenerationPreferences";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

const PREFERENCES_ENDPOINT = "/api/media-generation/preferences";

type PreferencesError = "load" | "save" | "";

type PreferencesResponse = {
  ok?: boolean;
  preferences?: unknown;
};

async function readPreferencesResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as PreferencesResponse | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error("AI_MEDIA_GENERATOR_PREFERENCES_REQUEST_FAILED");
  }
  return normalizeAiMediaGeneratorPreferences(payload.preferences);
}

export default function useAiMediaGeneratorPreferences() {
  const [preferences, setPreferences] = useState<AiMediaGeneratorPreferences>(() =>
    normalizeAiMediaGeneratorPreferences(null),
  );
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PreferencesError>("");
  const [savingBlockIds, setSavingBlockIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [accountEpoch, setAccountEpoch] = useState(0);
  const accountEpochRef = useRef(0);
  const patchControllersRef = useRef(new Set<AbortController>());

  useEffect(() => {
    const controller = new AbortController();
    const requestEpoch = accountEpochRef.current;
    setPreferences(normalizeAiMediaGeneratorPreferences(null));
    setLoaded(false);
    setLoading(true);
    setError("");

    void fetch(PREFERENCES_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(readPreferencesResponse)
      .then((nextPreferences) => {
        if (requestEpoch !== accountEpochRef.current) return;
        setPreferences(nextPreferences);
        setLoaded(true);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        if (requestEpoch !== accountEpochRef.current) return;
        setError("load");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        if (requestEpoch === accountEpochRef.current) setLoading(false);
      });

    return () => controller.abort();
  }, [accountEpoch]);

  useEffect(() => {
    const handleActiveAccountChange = () => {
      accountEpochRef.current += 1;
      for (const controller of patchControllersRef.current) controller.abort();
      patchControllersRef.current.clear();
      setSavingBlockIds(new Set());
      setAccountEpoch(accountEpochRef.current);
    };

    window.addEventListener(
      ACTIVE_INRCY_ACCOUNT_EVENT,
      handleActiveAccountChange,
    );
    return () => {
      window.removeEventListener(
        ACTIVE_INRCY_ACCOUNT_EVENT,
        handleActiveAccountChange,
      );
      for (const controller of patchControllersRef.current) controller.abort();
      patchControllersRef.current.clear();
    };
  }, []);

  const saveBlock = useCallback(
    async <K extends AiMediaGeneratorPreferenceBlockId>(
      blockId: K,
      saved: boolean,
      defaults: AiMediaGeneratorBlockDefaults[K],
    ) => {
      const controller = new AbortController();
      const requestEpoch = accountEpochRef.current;
      patchControllersRef.current.add(controller);
      setSavingBlockIds((current) => new Set(current).add(blockId));
      setError("");

      try {
        const response = await fetch(PREFERENCES_ENDPOINT, {
          method: "PATCH",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            blockId,
            saved,
            defaults: saved ? defaults : null,
          }),
          signal: controller.signal,
        });
        const nextPreferences = await readPreferencesResponse(response);
        if (requestEpoch !== accountEpochRef.current) return false;

        // Merge only the block targeted by this request. Concurrent saves can
        // complete out of order without reverting another block in the UI.
        setPreferences((current) => ({
          ...current,
          version: nextPreferences.version,
          blocks: {
            ...current.blocks,
            [blockId]: nextPreferences.blocks[blockId],
          },
        }));
        setLoaded(true);
        return true;
      } catch (caught) {
        if (controller.signal.aborted) return false;
        if (requestEpoch === accountEpochRef.current) setError("save");
        return false;
      } finally {
        patchControllersRef.current.delete(controller);
        if (requestEpoch === accountEpochRef.current) {
          setSavingBlockIds((current) => {
            const next = new Set(current);
            next.delete(blockId);
            return next;
          });
        }
      }
    },
    [],
  );

  return {
    preferences,
    loaded,
    loading,
    error,
    savingBlockIds,
    accountEpoch,
    saveBlock,
  };
}
