import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "ops/wordpress-visio-booking";
const archivePath = "ops/inrcy-visio-booking.zip";
const manifestPath = "ops/inrcy-visio-booking.manifest.json";
const pluginSlug = "inrcy-visio-booking";
const pluginFiles = [
  "README.md",
  "inrcy-visio-booking.css",
  "inrcy-visio-booking.js",
  "inrcy-visio-booking.php",
  "logo-inrcy-transparent.png",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Package only the reviewed plugin files; never include local files implicitly. */
export function createWordPressVisioPackage(sourceDirectory = path.join(repositoryRoot, sourcePath)) {
  const entries = readdirSync(sourceDirectory, { withFileTypes: true });
  const actualFiles = entries.map((entry) => entry.name).sort();
  if (entries.some((entry) => !entry.isFile()) ||
      actualFiles.join("\n") !== pluginFiles.join("\n")) {
    throw new Error("WordPress plugin files differ from the reviewed list; review missing or additional files before packaging.");
  }

  const sources = new Map(pluginFiles.map((name) => [name, readFileSync(path.join(sourceDirectory, name))]));
  const php = sources.get("inrcy-visio-booking.php").toString("utf8");
  const version = php.match(/^\s*\* Version:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  const runtimeVersion = php.match(/define\('INRCY_VISIO_BOOKING_VERSION',\s*'([^']+)'\)/)?.[1];
  if (!version || version !== runtimeVersion) {
    throw new Error("WordPress plugin header and runtime version must match.");
  }

  // ZIP uses local date fields. Construct fixed local fields rather than a UTC
  // instant so identical sources also produce identical bytes in every timezone.
  const fixedDate = new Date(1980, 0, 1, 0, 0, 0);
  const files = {};
  const manifestFiles = [];
  for (const [name, bytes] of sources) {
    const entryPath = `${pluginSlug}/${name}`;
    files[entryPath] = [bytes, { mtime: fixedDate, os: 3, attrs: 0o100644 << 16 }];
    manifestFiles.push({ path: entryPath, bytes: bytes.length, sha256: sha256(bytes) });
  }
  // Store entries without compression: bytes do not depend on compressor upgrades.
  const archive = Buffer.from(zipSync(files, { level: 0 }));
  const manifest = {
    schemaVersion: 1,
    plugin: pluginSlug,
    version,
    sourceDirectory: sourcePath,
    archivePath,
    archiveBytes: archive.length,
    archiveSha256: sha256(archive),
    files: manifestFiles,
  };
  return { archive, manifest, manifestText: `${JSON.stringify(manifest, null, 2)}\n` };
}

/** Read-only verification of both the archive and the source/hash manifest. */
export function checkWordPressVisioPackage(result, destinations = {}) {
  const zip = destinations.archivePath || path.join(repositoryRoot, archivePath);
  const manifest = destinations.manifestPath || path.join(repositoryRoot, manifestPath);
  const mismatches = [];
  for (const [file, expected] of [[zip, result.archive], [manifest, Buffer.from(result.manifestText)]]) {
    try {
      if (!readFileSync(file).equals(expected)) mismatches.push(path.basename(file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      mismatches.push(path.basename(file));
    }
  }
  if (mismatches.length) {
    throw new Error(`WordPress package is missing or stale: ${mismatches.join(", ")}. Run node scripts/build-wordpress-visio-booking.mjs.`);
  }
}

function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/build-wordpress-visio-booking.mjs [--check]");
    return;
  }
  if (args.length > 1 || args.some((arg) => arg !== "--check")) {
    throw new Error("Expected no arguments or --check. Use --help for usage.");
  }
  const result = createWordPressVisioPackage();
  if (args.includes("--check")) {
    checkWordPressVisioPackage(result);
  } else {
    writeFileSync(path.join(repositoryRoot, archivePath), result.archive);
    writeFileSync(path.join(repositoryRoot, manifestPath), result.manifestText);
  }
  console.log(`${args.includes("--check") ? "Verified" : "Built"} ${archivePath} v${result.manifest.version}: ${result.manifest.files.length} files, SHA-256 ${result.manifest.archiveSha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
