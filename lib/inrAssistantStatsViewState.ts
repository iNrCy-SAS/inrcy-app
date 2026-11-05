import type { InrAssistantStatsChannel, InrAssistantStatsViewPatch } from "./inrAssistantStatsUiCommands.ts";
import type { VisibilityIndexRange } from "./inrstats/visibilityIndexSnapshots.ts";

export type InrAssistantStatsIndexHistory = {
  accountId: string; channel: string; range: VisibilityIndexRange | null;
  availableRanges: readonly VisibilityIndexRange[]; ready: boolean;
};
export type InrAssistantStatsViewState = {
  accountId: string; panel: string; evolutionView: "measured" | "index";
  metric: "visibility" | "clicks"; measuredChannel: string; indexChannel: string;
  indexHistory: InrAssistantStatsIndexHistory;
};
export type InrAssistantStatsViewChanges = {
  panel?: InrAssistantStatsViewPatch["panel"]; evolutionView?: "measured" | "index";
  metric?: "visibility" | "clicks"; measuredChannel?: "all" | InrAssistantStatsChannel;
  indexChannel?: "all" | InrAssistantStatsChannel; indexRangeMonths?: VisibilityIndexRange;
};

export function selectedStatsVisibilityIndexRange(available: readonly VisibilityIndexRange[], preferredRange: VisibilityIndexRange): VisibilityIndexRange | null {
  return available.includes(preferredRange) ? preferredRange : available.includes(1) ? 1 : available[0] ?? null;
}

/** The native evolution views own independent channel filters. A period is
 * actionable only after this account/channel's real history unlocked it. */
export function planInrAssistantStatsViewPatch(state: InrAssistantStatsViewState, patch: InrAssistantStatsViewPatch, channels: readonly string[]): InrAssistantStatsViewChanges | null {
  if (patch.panel !== undefined && !["all", "evolution", ...channels].includes(patch.panel)
    || patch.channel !== undefined && !["all", ...channels].includes(patch.channel)) return null;
  const view = patch.evolutionView ?? state.evolutionView;
  if (patch.metric !== undefined && view !== "measured") return null;
  if (patch.indexRangeMonths !== undefined) {
    const history = state.indexHistory;
    if (view !== "index" || !history.ready || history.accountId !== state.accountId
      || history.channel !== (patch.channel ?? state.indexChannel)
      || !history.availableRanges.includes(patch.indexRangeMonths)) return null;
  }
  return {
    ...(patch.panel !== undefined ? { panel: patch.panel } : {}),
    ...(patch.evolutionView !== undefined ? { evolutionView: patch.evolutionView } : {}),
    ...(patch.metric !== undefined ? { metric: patch.metric } : {}),
    ...(patch.channel !== undefined ? view === "index" ? { indexChannel: patch.channel } : { measuredChannel: patch.channel } : {}),
    ...(patch.indexRangeMonths !== undefined ? { indexRangeMonths: patch.indexRangeMonths } : {}),
  };
}

/** Read the committed target view, never the hidden filter of the other view. */
export function isInrAssistantStatsViewPatchApplied(state: InrAssistantStatsViewState, patch: InrAssistantStatsViewPatch): boolean {
  const view = patch.evolutionView ?? state.evolutionView;
  return (patch.panel === undefined || state.panel === patch.panel)
    && (patch.evolutionView === undefined || state.evolutionView === patch.evolutionView)
    && (patch.metric === undefined || view === "measured" && state.metric === patch.metric)
    && (patch.channel === undefined || (view === "index" ? state.indexChannel : state.measuredChannel) === patch.channel)
    && (patch.indexRangeMonths === undefined || view === "index" && state.indexHistory.ready
      && state.indexHistory.accountId === state.accountId && state.indexHistory.channel === state.indexChannel
      && state.indexHistory.range === patch.indexRangeMonths && state.indexHistory.availableRanges.includes(patch.indexRangeMonths));
}
