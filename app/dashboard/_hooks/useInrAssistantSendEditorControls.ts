"use client";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";
type Target = "edit" | "library" | "generate" | "video_retouch";
type Guard = () => boolean;
export function useInrAssistantSendEditorControls(options: {
  enabled: boolean; busy: boolean; stateKey: string; editing: boolean; libraryOpen: boolean; studioTab: string | null;
  edit(): void; library(): void; generate(guard: Guard): Promise<void>; videoRetouch(guard: Guard): void | Promise<void>; closeLibrary(): void;
}) {
  const controls = useRef(new Map<Target, HTMLButtonElement>());
  const stateKey = options.stateKey;
  const currentKey = useRef(stateKey), alive = useRef(false);
  useLayoutEffect(() => { currentKey.current = stateKey; }, [stateKey]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const state = { stateKey: options.stateKey, editing: options.editing, libraryOpen: options.libraryOpen, studioTab: options.studioTab };
  useInrAssistantLocalInterface("send_editor", state, {
    select: {
      async invoke(value, stillCurrent) {
        const valid = () => stillCurrent() && alive.current && currentKey.current === stateKey;
        if (!valid() || !["edit", "library", "generate", "video_retouch"].includes(String(value))) throw new Error("Unavailable publication editor");
        const target = value as Target, button = controls.current.get(target);
        if (!button?.isConnected || button.disabled) throw new Error("Publication editor control is not visible");
        if (target === "edit") options.edit(); else if (!options.editing) throw new Error("Publication edit is not open");
        else if (target === "library") options.library(); else if (target === "generate") await options.generate(valid); else await options.videoRetouch(valid);
        if (!valid()) throw new Error("Publication editor scope changed");
      },
      matches(value, target) {
        const current = value as typeof state;
        return current.stateKey === state.stateKey && (target === "edit" ? current.editing : target === "library" ? current.libraryOpen : target === "generate" ? current.studioTab === "generate" : target === "video_retouch" && current.studioTab === "retouch");
      },
    },
    ...(options.libraryOpen ? { close: { invoke: () => options.closeLibrary(), matches: (value: unknown) => !(value as typeof state).libraryOpen } } : {}),
  }, options.enabled, options.busy || options.studioTab !== null);
  return useCallback((target: Target) => (node: HTMLButtonElement | null) => { if (node) controls.current.set(target, node); else controls.current.delete(target); }, []);
}
