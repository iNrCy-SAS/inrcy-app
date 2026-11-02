import { readFileSync } from "node:fs";

// Source contracts follow the responsibilities extracted from the worker.
export function readVideoNormalizationWorkerSource() {
  return [
    "mediaVideoNormalizationWorker",
    "mediaVideoNormalizationWorkerTypes",
    "mediaVideoNormalizationWorkerPolicy",
    "mediaVideoNormalizationRepository",
    "mediaVideoNormalizationStorage",
    "mediaVideoNormalizationSettlement",
  ].map((name) => readFileSync(new URL(`../../lib/${name}.ts`, import.meta.url), "utf8").replace(/\r\n/g, "\n")).join("\n");
}
