export type ConnectionRecoveryCheck = {
  id: string;
  severity: "ok" | "warn" | "error" | "running" | "pending";
};
export type ConnectionRecoveryStep = "wait" | "network" | "storage" | "credentials";

/** Public diagnostic observations only; successful browser checks never prove authentication. */
export function connectionRecoverySteps(checks: readonly ConnectionRecoveryCheck[], running: boolean): ConnectionRecoveryStep[] {
  if (running || !checks.length || checks.some(check => check.severity === "pending" || check.severity === "running")) return ["wait"];
  const failed = (ids: readonly string[]) => checks.some(check => ids.includes(check.id) && (check.severity === "warn" || check.severity === "error"));
  const steps: ConnectionRecoveryStep[] = [];
  if (failed(["browser", "api-ping", "asset-logo"])) steps.push("network");
  if (failed(["local-storage", "session-storage", "cookies"])) steps.push("storage");
  // A retry remains a user action; never clear sessions, resend mail or submit a report here.
  steps.push("credentials");
  return steps;
}
