import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repository = fileURLToPath(new URL("../../", import.meta.url));
export const phpBinary = process.env.PHP_BINARY || "php";
export const pages = {
  home: "/basique/", features: "/basique/fonctionnalites/", pricing: "/basique/tarif/", faq: "/basique/faq/",
  signup: "/basique/inscription/", contact: "/basique/contact/", terms: "/basique/conditions/",
  privacy: "/basique/confidentialite/", cookies: "/basique/cookies/", legal: "/basique/mentions-legales/",
} as const;
export type View = keyof typeof pages;
export const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

export function php(action: string, view: View = "home", options: Record<string, unknown> = {}): string {
  const result = spawnSync(phpBinary, ["-n", "tests/wordpress-basic-signup/wp-runtime.php", action, view, JSON.stringify(options)], {
    cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`PHP runtime unavailable. Install PHP or set PHP_BINARY to its executable (Windows: the portable php.exe). ${result.error.message}`);
  if (result.status !== 0 || /(?:PHP (?:Warning|Fatal)|Fatal error|Warning:)/.test(result.stderr + result.stdout)) throw new Error(`Real plugin PHP failed (${result.status}): ${result.stderr}\n${result.stdout.slice(0, 1200)}`);
  return result.stdout;
}

export const phpJson = (action: string, options: Record<string, unknown> = {}, view: View = "home") => JSON.parse(php(action, view, options));
export const render = (view: View = "home", options: Record<string, unknown> = {}) => php("render", view, options);
