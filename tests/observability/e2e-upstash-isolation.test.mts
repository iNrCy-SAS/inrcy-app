import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("le serveur E2E local n'utilise jamais le Redis partagé", () => {
  const config = readFileSync(
    new URL("../../playwright.config.ts", import.meta.url),
    "utf8",
  );
  const webServer = config.slice(config.indexOf("webServer:"));

  assert.match(webServer, /KV_REST_API_URL:\s*''/);
  assert.match(webServer, /KV_REST_API_TOKEN:\s*''/);
});
