"use client";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";

export function useInrAssistantPlanningWorkspaceControls(options: {
  enabled: boolean; calendarOpen: boolean; helpOpen: boolean; busy: boolean; stateKey: string;
  open(target: "calendar" | "help", stillCurrent: () => boolean): Promise<void>;
  closeHelp(): void;
}) {
  const state = { calendarOpen: options.calendarOpen, helpOpen: options.helpOpen, stateKey: options.stateKey };
  useInrAssistantLocalInterface("planning_workspace", state, {
    ...(!options.helpOpen ? { open: { invoke: (_value: string | null, stillCurrent: () => boolean) => options.open("calendar", stillCurrent), matches: (value: unknown) => (value as typeof state).calendarOpen },
    select: {
      invoke: (value: string | null, stillCurrent: () => boolean) => { if (value !== "help") throw new Error("Unavailable planning section"); return options.open("help", stillCurrent); },
      matches: (value: unknown) => (value as typeof state).helpOpen,
    } } : {}),
    ...(options.helpOpen ? { close: { invoke: () => options.closeHelp(), matches: (value: unknown) => !(value as typeof state).helpOpen } } : {}),
  }, options.enabled, options.busy, options.helpOpen ? 1 : 0);
}
