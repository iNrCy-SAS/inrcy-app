import type { CubeModel } from "./stats.shared.types";

export type StatsRecommendedTool =
  | "booster"
  | "propulser"
  | "fideliser"
  | "connection";

export function isPremiumStatsRecommendedTool(
  tool: StatsRecommendedTool | null | undefined,
): boolean {
  return tool === "propulser" || tool === "fideliser";
}

export function isPremiumStatsAction(
  action: CubeModel["action"],
): boolean {
  return (
    action.key === "propulser_action" ||
    action.key.startsWith("fideliser_") ||
    action.href.startsWith("/dashboard/propulser") ||
    action.href.startsWith("/dashboard/fideliser")
  );
}

/**
 * Standard conserve l'analyse iNrStats, mais une recommandation vers un
 * outil Premium reste visible, explicitement verrouillee et non navigable.
 */
export function applyStatsEditionActionPolicy(
  action: CubeModel["action"],
  standardMode: boolean,
): CubeModel["action"] {
  if (!standardMode || !isPremiumStatsAction(action)) return action;

  return {
    ...action,
    href: "",
    premiumLocked: true,
  };
}
