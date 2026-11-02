import { readFileSync } from "node:fs";

// Source contracts span the explicit modules of this use case. Runtime tests
// below execute the route and services; authorization/order checks use the route.
export const agentPublicationPreparationPaths = [
  "app/api/agent/actions/prepare-publish/route.ts",
  "lib/inrAgentPublicationPreparationPolicy.ts",
  "lib/inrAgentPublicationPreparationRepository.ts",
  "lib/inrAgentPublicationMediaSelection.ts",
  "lib/inrAgentPublicationMediaAnalysis.ts",
  "lib/inrAgentPublicationEditorialService.ts",
];
export function readAgentPublicationPreparationSource() {
  return agentPublicationPreparationPaths.map((path) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
  ).join("\n");
}
