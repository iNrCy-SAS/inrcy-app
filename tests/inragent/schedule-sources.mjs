import { readFileSync } from "node:fs";

// Structural contracts follow all explicit owners of this scheduling use case.
// Runtime tests execute the transaction coordinator and snapshot service.
export function readAgentScheduleSource() {
  return [
    "app/api/agent/actions/schedule/route.ts",
    "lib/inrAgentScheduleTypes.ts",
    "lib/inrAgentSchedulePolicy.ts",
    "lib/inrAgentSchedulePayloadBuilder.ts",
    "lib/inrAgentScheduledMediaSnapshot.ts",
    "lib/inrAgentScheduleService.ts",
  ].map((path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")).join("\n");
}
