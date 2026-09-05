import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../lib/observability/sentryEventFilter.ts", import.meta.url),
  "utf8",
);

test("Sentry expurge les images encodées des erreurs et breadcrumbs", () => {
  assert.match(source, /IMAGE_DATA_URL_RE/);
  assert.match(source, /LONG_BASE64_RE/);
  assert.match(source, /mutableEvent\.message = scrubBinaryPayloads/);
  assert.match(source, /item\.value = scrubBinaryPayloads/);
  assert.match(source, /breadcrumb\.message = scrubBinaryPayloads/);
  assert.match(source, /delete mutableEvent\.request\.data/);
});
