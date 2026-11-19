import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, unzipSync } from "fflate";

const source = fileURLToPath(new URL("./", import.meta.url));
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("Pass an absolute output directory.");
const files = ["README.md", "inrcy-basic-signup.php", "basic-page.php", "basic-signup.js", "basic-signup.css", "basic-access.js", "basic-access.css", "logo-inrcy-transparent.png", "basic-site.css", "basic-site.js", "basic-meta-attribution.js",
  "includes/catalogue.php", "includes/legal-content.php", "includes/legal-reviewed.php", "includes/site.php", "includes/seo.php",
  "includes/legal/terms.html", "includes/legal/privacy.html", "includes/legal/legal.html", "templates/site-shell.php", "templates/signup-form.php", "templates/unavailable.php",
  ...["home", "features", "pricing", "faq", "signup", "contact", "legal", "cookies"].map(view => `templates/pages/${view}.php`)];
const php = readFileSync(path.join(source, "inrcy-basic-signup.php"), "utf8");
const version = php.match(/Version:\s*([\d.]+)/)?.[1];
if (!version || !php.includes(`define('INRCY_BASIC_SIGNUP_VERSION', '${version}')`)) throw new Error("Plugin versions differ.");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = {}, date = new Date(1980, 0, 1);
const records = files.map(name => {
  const bytes = readFileSync(path.join(source, name)), entry = `inrcy-basic-signup/${name}`;
  entries[entry] = [bytes, { mtime: date, os: 3, attrs: 0o100644 << 16 }];
  return { path: entry, bytes: bytes.length, sha256: sha(bytes) };
});
const archive = Buffer.from(zipSync(entries, { level: 0 })), unpacked = unzipSync(archive);
for (const file of records) if (sha(unpacked[file.path]) !== file.sha256) throw new Error(`Archive mismatch: ${file.path}`);
mkdirSync(output, { recursive: true });
const archiveName = `inrcy-basic-signup-${version}.zip`;
writeFileSync(path.join(output, archiveName), archive);
const manifest = { version, archive: archiveName, archiveBytes: archive.length, archiveSha256: sha(archive), files: records };
writeFileSync(path.join(output, `inrcy-basic-signup-${version}.manifest.json`), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ archive: path.join(output, archiveName), sha256: manifest.archiveSha256, bytes: archive.length, files: records.length }, null, 2));
