import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(
  new URL("../ios/App/CapApp-SPM/Package.swift", import.meta.url),
);

if (!existsSync(manifestPath)) {
  process.exit(0);
}

const source = readFileSync(manifestPath, "utf8");
const normalized = source.replace(
  /(path:\s*"[^"]*)\\([^"]*")/g,
  (_match, prefix, suffix) => `${prefix}/${suffix.replaceAll("\\", "/")}`,
);

if (normalized !== source) {
  writeFileSync(manifestPath, normalized, "utf8");
  process.stdout.write("Normalized iOS Swift Package paths.\n");
}
