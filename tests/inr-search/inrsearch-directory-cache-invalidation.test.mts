import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("the public directory API never serves a stale membership response", () => {
  const route = read("app/api/public/inrsearch/directory/route.ts");

  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export const revalidate = 0/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.doesNotMatch(route, /s-maxage|stale-while-revalidate/);
});

test("directory changes trigger an authenticated WordPress purge", () => {
  const cache = read("lib/inrSearchDirectoryCache.ts");
  const settings = read("app/api/inr-search/settings/route.ts");
  const settingsUi = read("app/dashboard/settings/_components/InrSearchSettingsContent.tsx");
  const adminTools = read("app/api/admin/tools/route.ts");

  assert.match(cache, /createHmac\("sha256", secret\)/);
  assert.match(cache, /update\(`\$\{timestamp\}\.\$\{body\}`\)/);
  assert.match(cache, /"X-iNrCy-Timestamp": timestamp/);
  assert.match(cache, /"X-iNrCy-Signature": signature/);
  assert.match(cache, /cache: "no-store"/);
  assert.match(settings, /await purgeInrSearchDirectoryCache/);
  assert.match(settings, /directory_enabled/);
  assert.match(settings, /directory_disabled/);
  assert.match(settingsUi, /payload\?\.directoryCache\?\.ok === false/);
  assert.match(adminTools, /await purgeInrSearchDirectoryCache\(\{ reason: "admin_access_changed" \}\)/);
});

test("the WordPress plugin invalidates every filter and page cache atomically", () => {
  const plugin = read("ops/wordpress-directory-plugin/inrcy-directory.php");

  assert.match(plugin, /Version: 1\.4\.2/);
  assert.match(plugin, /register_rest_route\(/);
  assert.match(plugin, /'\/directory-cache\/purge'/);
  assert.match(plugin, /hash_hmac\('sha256', \$timestamp \. '\.' \. \$request->get_body\(\), \$secret\)/);
  assert.match(plugin, /hash_equals\(\$expected, \$signature\)/);
  assert.match(plugin, /abs\(time\(\) - \(int\) \$timestamp\) > 300/);
  assert.match(plugin, /inrcy_directory_bump_cache_version\(\)/);
  assert.match(plugin, /\$cache_suffix = inrcy_directory_cache_version\(\) \. '_' \. md5\(\$url\)/);
  assert.match(plugin, /\$cache_key = 'inrcy_directory_' \. \$cache_suffix/);
  assert.match(plugin, /\$stale_cache_key = 'inrcy_directory_stale_' \. \$cache_suffix/);
  assert.match(plugin, /define\('INRCY_DIRECTORY_CACHE_TTL', HOUR_IN_SECONDS\)/);
  assert.match(plugin, /define\('INRCY_DIRECTORY_STALE_TTL', DAY_IN_SECONDS\)/);
});

test("the WordPress public pagination avoids WordPress reserved query variables", () => {
  const plugin = read("ops/wordpress-directory-plugin/inrcy-directory.php");
  const apiFunction = plugin.match(
    /function inrcy_directory_api_url[\s\S]*?(?=function inrcy_directory_empty_result)/,
  )?.[0];
  const paginationFunction = plugin.match(
    /function inrcy_directory_render_pagination[\s\S]*?(?=function inrcy_directory_render_schema)/,
  )?.[0];

  assert.ok(apiFunction);
  assert.ok(paginationFunction);
  assert.match(plugin, /define\('INRCY_DIRECTORY_PAGE_QUERY_ARG', 'inrcy_page'\)/);
  assert.match(apiFunction, /'page' => max\(1, absint\(\$page\)\)/);
  assert.doesNotMatch(apiFunction, /inrcy_page|INRCY_DIRECTORY_PAGE_QUERY_ARG/);
  assert.equal(paginationFunction.match(/INRCY_DIRECTORY_PAGE_QUERY_ARG/g)?.length, 3);
  assert.doesNotMatch(paginationFunction, /array\('page' =>/);
  assert.match(
    plugin,
    /inrcy_directory_get_filter\(INRCY_DIRECTORY_PAGE_QUERY_ARG\)/,
  );
  assert.doesNotMatch(plugin, /inrcy_directory_get_filter\('page'\)/);
});

test("the WordPress directory 1.4 is accessible, responsive and machine-readable", () => {
  const plugin = read("ops/wordpress-directory-plugin/inrcy-directory.php");

  assert.match(plugin, /'@type' => 'CollectionPage'/);
  assert.match(plugin, /'@type' => 'LocalBusiness'/);
  assert.match(plugin, /function inrcy_directory_body_class/);
  assert.match(plugin, /\.ast-article-single>\.entry-header\{display:none\}/);
  assert.doesNotMatch(plugin, /<h2><a href=/);
  assert.match(plugin, /Voir le profil iNr’Search de %s/);
  assert.match(plugin, /inrcy-directory__join/);
  assert.match(plugin, /min-width:44px;min-height:44px/);
  assert.match(
    plugin,
    /\.inrcy-directory__grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(270px,1fr\)\);gap:16px\}/,
  );
  assert.doesNotMatch(plugin, /repeat\(auto-fit,minmax\(270px,1fr\)\)/);
  assert.match(plugin, /@media \(max-width:700px\)/);
  assert.match(plugin, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(plugin, /rank_math\/opengraph\/facebook\/image/);
  assert.match(plugin, /rank_math\/opengraph\/twitter\/image/);
});
