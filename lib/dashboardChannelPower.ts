export type DashboardChannelPowerStep = { weight: number; completed: boolean };

/** Fixed channel contributions never increase when other channels are hidden. */
export function computeDashboardChannelPower(steps: readonly DashboardChannelPowerStep[]): number {
  const completed = steps.reduce((sum, step) => sum + (step.completed ? Math.max(0, step.weight) : 0), 0);
  return Math.min(100, completed);
}

/** Access changes cap a cached score synchronously, before fresh channel states arrive. */
export function clampDashboardChannelPowerForAccess(value: number | null, availableWeight: number): number {
  return Math.min(Math.max(0, value ?? 0), Math.max(0, Math.min(100, availableWeight)));
}
