"use client";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveBrowserUserId, resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { getInrAssistantDocumentPrefillRequest, type InrAssistantDocumentPrefill } from "@/lib/inrAssistantDocumentUiCommands";
import type { useDocumentUnsavedChanges } from "./useDocumentUnsavedChanges";

/** Reuses the native form mappers. A source receipt is exposed only by the committed
 * render after hydration; the URL or completed read alone is not an applied form. */
export function useDocumentAssistantPrefill(options: {
  kind: "quote" | "invoice";
  params: { get: (key: string) => string | null };
  supabase: Pick<SupabaseClient, "auth" | "from">;
  ready: boolean;
  documentId: string;
  configurationVersion: string;
  edits: ReturnType<typeof useDocumentUnsavedChanges>;
  applyTemplate: (payload: Record<string, unknown>) => void;
  applyConversion?: (payload: Record<string, unknown>, sourceId: string) => void;
  onFailure: () => void;
}) {
  const request = getInrAssistantDocumentPrefillRequest(options.kind, options.params);
  const serialized = request ? JSON.stringify(request) : null;
  const completed = useRef<string | null>(null);
  const configuration = useRef(options.configurationVersion);
  useLayoutEffect(() => { configuration.current = options.configurationVersion; }, [options.configurationVersion]);
  const [applied, setApplied] = useState<{ source: InrAssistantDocumentPrefill; accountId: string; generation: number; key: string } | null>(null);
  const [committed, setCommitted] = useState<{ applied: typeof applied; signature: string; configuration: string } | null>(null);
  const signature = options.edits.contentSignature, generation = options.edits.generation, documentId = options.documentId;
  const configurationVersion = options.configurationVersion;
  useLayoutEffect(() => {
    if (applied && committed?.applied !== applied && !documentId && applied.accountId === getActiveBrowserUserId() && applied.generation === generation) {
      setCommitted({ applied, signature, configuration: configurationVersion });
    }
  }, [applied, committed?.applied, configurationVersion, documentId, generation, signature]);
  const load = useEffectEvent(async (source: InrAssistantDocumentPrefill, key: string, alive: () => boolean) => {
    const started = options.edits.captureSave();
    const startedConfiguration = configuration.current;
    const valid = () => alive() && options.edits.isUnchanged(started) && configuration.current === startedConfiguration;
    const { data: { user }, error: authError } = await options.supabase.auth.getUser();
    if (!valid()) return;
    if (authError || !user) { options.onFailure(); return; }
    const accountId = resolveActiveBrowserUserId(user.id);
    const kind = source.operation === "convert_quote" || source.kind === "quote" ? "devis" : "facture";
    const { data, error } = await options.supabase.from("doc_saves").select("id,user_id,type,updated_at,payload")
      .eq("id", source.sourceId).eq("user_id", accountId).eq("type", kind).maybeSingle();
    if (!valid() || accountId !== getActiveBrowserUserId()) return;
    if (error || !data || data.id !== source.sourceId || data.user_id !== accountId || data.type !== kind ||
      data.updated_at !== source.expectedUpdatedAt || !data.payload || typeof data.payload !== "object" ||
      (source.operation === "apply_template" ? data.payload.isTemplate !== true : data.payload.isTemplate === true) ||
      source.operation === "convert_quote" && !options.applyConversion) { options.onFailure(); return; }
    await options.edits.requestNavigation(() => {
      if (!valid() || accountId !== getActiveBrowserUserId() || completed.current === key) return;
      if (source.operation === "apply_template") options.applyTemplate(data.payload);
      else options.applyConversion!(data.payload, source.sourceId);
      options.edits.markPrefilled();
      completed.current = key;
      setApplied({ source, accountId, generation: options.edits.captureSave().generation, key });
    });
  });
  const onFailure = useEffectEvent(() => options.onFailure());
  useEffect(() => {
    if (!serialized || !options.ready || completed.current === serialized) return;
    let active = true;
    void load(JSON.parse(serialized), serialized, () => active).catch(() => { if (active) onFailure(); });
    return () => { active = false; };
  }, [serialized, options.ready]);
  return applied && committed?.applied === applied && committed.signature === signature && committed.configuration === configurationVersion &&
    applied.key === serialized && !documentId && applied.accountId === getActiveBrowserUserId() && applied.generation === generation ? applied.source : undefined;
}
