import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { unzipSync } from "fflate";
import { createWordPressVisioPackage, checkWordPressVisioPackage } from "../../scripts/build-wordpress-visio-booking.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = path.join(root, "ops/wordpress-visio-booking");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, "inrcy-wordpress-package-"));
  assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
  assert.ok(path.basename(directory).startsWith("inrcy-wordpress-package-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const copy = path.join(directory, "source");
  cpSync(source, copy, { recursive: true });
  return { directory, copy };
}

test("the distributable contains every current source, including the referenced logo, with verified hashes", () => {
  const result = createWordPressVisioPackage();
  const files = unzipSync(result.archive);
  assert.match(result.manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(files), result.manifest.files.map((file) => file.path));
  assert.equal(Object.keys(files).length, 5);
  assert.ok(files["inrcy-visio-booking/logo-inrcy-transparent.png"]);
  for (const file of result.manifest.files) {
    const actual = files[file.path];
    assert.deepEqual(Buffer.from(actual), readFileSync(path.join(source, path.basename(file.path))));
    assert.equal(actual.length, file.bytes);
    assert.equal(sha256(actual), file.sha256);
  }
  assert.equal(sha256(result.archive), result.manifest.archiveSha256);
  checkWordPressVisioPackage(result);
});

test("file timestamps and process timezones do not change the ZIP bytes", (t) => {
  const { copy } = fixture(t);
  const original = createWordPressVisioPackage(copy);
  utimesSync(path.join(copy, "inrcy-visio-booking.php"), new Date(), new Date());
  assert.deepEqual(createWordPressVisioPackage(copy).archive, original.archive);
  const builderUrl = new URL("../../scripts/build-wordpress-visio-booking.mjs", import.meta.url).href;
  for (const timezone of ["UTC", "Pacific/Honolulu", "Europe/Paris"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { createWordPressVisioPackage } from ${JSON.stringify(builderUrl)}; console.log(createWordPressVisioPackage().manifest.archiveSha256);`,
    ], { cwd: root, env: { ...process.env, TZ: timezone }, encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), original.manifest.archiveSha256);
  }
});

test("check detects a stale archive or manifest and never rewrites either file", (t) => {
  const { directory } = fixture(t);
  const result = createWordPressVisioPackage();
  const destinations = { archivePath: path.join(directory, "plugin.zip"), manifestPath: path.join(directory, "manifest.json") };
  assert.throws(() => checkWordPressVisioPackage(result, destinations), /missing or stale/);
  writeFileSync(destinations.archivePath, result.archive);
  writeFileSync(destinations.manifestPath, result.manifestText);
  checkWordPressVisioPackage(result, destinations);
  writeFileSync(destinations.archivePath, "obsolete ZIP");
  assert.throws(() => checkWordPressVisioPackage(result, destinations), /plugin.zip/);
  assert.equal(readFileSync(destinations.archivePath, "utf8"), "obsolete ZIP");
  writeFileSync(destinations.archivePath, result.archive);
  writeFileSync(destinations.manifestPath, "obsolete manifest");
  assert.throws(() => checkWordPressVisioPackage(result, destinations), /manifest.json/);
  assert.equal(readFileSync(destinations.manifestPath, "utf8"), "obsolete manifest");
});

test("missing assets, unexpected local files and mismatched plugin versions stop packaging", (t) => {
  const { copy } = fixture(t);
  const logoPath = path.join(copy, "logo-inrcy-transparent.png");
  const logo = readFileSync(logoPath);
  rmSync(logoPath);
  assert.throws(() => createWordPressVisioPackage(copy), /reviewed list/);
  writeFileSync(logoPath, logo);
  const localPath = path.join(copy, ".env.local");
  writeFileSync(localPath, "SYNTHETIC_TEST_VALUE=not-a-secret\n");
  assert.throws(() => createWordPressVisioPackage(copy), /reviewed list/);
  rmSync(localPath);
  const phpPath = path.join(copy, "inrcy-visio-booking.php");
  writeFileSync(phpPath, readFileSync(phpPath, "utf8").replace(/Version: \d+\.\d+\.\d+/, "Version: 999.999.999"));
  assert.throws(() => createWordPressVisioPackage(copy), /version must match/);
});
