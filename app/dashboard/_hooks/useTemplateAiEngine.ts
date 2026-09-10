"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import {
  DEFAULT_AI_PREFERRED_ENGINE,
  getAiPreferredEngineFromBusiness,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";

export function useTemplateAiEngine() {
  const [defaultEngine, setDefaultEngine] = useState<AiPreferredEngine>(DEFAULT_AI_PREFERRED_ENGINE);
  const [engine, setEngine] = useState<AiPreferredEngine>(DEFAULT_AI_PREFERRED_ENGINE);
  const explicitEngineRef = useRef(false);

  const selectEngine = useCallback((next: AiPreferredEngine) => {
    explicitEngineRef.current = true;
    setEngine(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) return;
        const activeUserId = resolveActiveBrowserUserId(user.id);
        const { data: business } = await supabase
          .from("business_profiles")
          .select("ai_preferred_engine,updated_at")
          .eq("user_id", activeUserId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        const resolved = getAiPreferredEngineFromBusiness(business || {});
        setDefaultEngine(resolved);
        if (!explicitEngineRef.current) setEngine(resolved);
      } catch {
        // Le moteur OpenAI reste le repli sûr si le profil n'est pas lisible.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { engine, setEngine: selectEngine, defaultEngine };
}
