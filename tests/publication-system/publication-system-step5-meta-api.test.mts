import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  META_GRAPH_API_BASE_URL,
  META_GRAPH_API_DEFAULT_VERSION,
  META_GRAPH_API_VERSION,
  META_OAUTH_BASE_URL,
  buildMetaGraphUrl,
  buildMetaOAuthUrl,
  normalizeMetaGraphApiVersion,
} from "../../lib/metaGraphApi.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const META_FILES = [
  "lib/facebookPublish.ts",
  "lib/instagramPublish.ts",
  "lib/inrsend/publicationChannelActions.ts",
  "lib/metaBusinessAssets.ts",
  "lib/metaInsights.ts",
  "lib/facebookInsights.ts",
  "app/api/integrations/facebook/start/route.ts",
  "app/api/integrations/facebook/callback/route.ts",
  "app/api/integrations/instagram/start/route.ts",
  "app/api/integrations/instagram/callback/route.ts",
] as const;

test("Meta utilise v25.0 par défaut avec rollback contrôlé", () => {
  assert.equal(META_GRAPH_API_DEFAULT_VERSION, "v25.0");
  assert.match(META_GRAPH_API_VERSION, /^v\d+\.\d+$/);
  assert.equal(normalizeMetaGraphApiVersion("v24.0"), "v24.0");
  assert.equal(normalizeMetaGraphApiVersion("25.0"), "v25.0");
  assert.equal(normalizeMetaGraphApiVersion("javascript:alert(1)"), "v25.0");
});

test("les bases Graph et OAuth partagent exactement la même version", () => {
  assert.equal(
    META_GRAPH_API_BASE_URL,
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}`,
  );
  assert.equal(
    META_OAUTH_BASE_URL,
    `https://www.facebook.com/${META_GRAPH_API_VERSION}`,
  );
  assert.equal(
    buildMetaGraphUrl("me/accounts"),
    `${META_GRAPH_API_BASE_URL}/me/accounts`,
  );
  assert.equal(
    buildMetaOAuthUrl("/dialog/oauth"),
    `${META_OAUTH_BASE_URL}/dialog/oauth`,
  );
});

test("aucun parcours Facebook ou Instagram ne garde une version codée en dur", () => {
  for (const relativePath of META_FILES) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /(?:graph|www)\.facebook\.com\/v\d+\.\d+/,
      `${relativePath} contient encore une URL Meta versionnée en dur`,
    );
    assert.doesNotMatch(
      source,
      /const\s+FACEBOOK_GRAPH_VERSION\s*=/,
      `${relativePath} contient encore une constante locale Meta`,
    );
    assert.match(
      source,
      /metaGraphApi/,
      `${relativePath} doit utiliser le contrat Meta central`,
    );
  }
});

test("publication, OAuth, assets, statistiques et iNrSend utilisent tous le contrat central", () => {
  assert.match(read("lib/facebookPublish.ts"), /buildMetaGraphUrl/);
  assert.match(read("lib/instagramPublish.ts"), /buildMetaGraphUrl/);
  assert.match(read("lib/inrsend/publicationChannelActions.ts"), /buildMetaGraphUrl/);
  assert.match(read("lib/metaBusinessAssets.ts"), /buildMetaGraphUrl/);
  assert.match(read("lib/metaInsights.ts"), /META_GRAPH_API_BASE_URL/);
  assert.match(read("lib/facebookInsights.ts"), /META_GRAPH_API_BASE_URL/);
  assert.match(read("app/api/integrations/facebook/start/route.ts"), /buildMetaOAuthUrl/);
  assert.match(read("app/api/integrations/instagram/start/route.ts"), /buildMetaOAuthUrl/);
});

test("les permissions OAuth existantes restent inchangées", () => {
  const facebook = read("app/api/integrations/facebook/start/route.ts");
  const instagram = read("app/api/integrations/instagram/start/route.ts");
  for (const permission of [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
  ]) {
    assert.match(facebook, new RegExp(permission));
  }
  for (const permission of [
    "instagram_basic",
    "instagram_manage_insights",
    "instagram_content_publish",
  ]) {
    assert.match(instagram, new RegExp(permission));
  }
});


test("Facebook Insights migre vers Media Views sans nouveau scope", () => {
  const insights = read("lib/facebookInsights.ts");
  const facebook = read("app/api/integrations/facebook/start/route.ts");
  const stats = read("app/dashboard/stats/stats.shared.metrics.ts");

  for (const metric of [
    "page_media_view",
    "page_total_media_view_unique",
    "post_media_view",
    "post_total_media_view_unique",
  ]) {
    assert.match(insights, new RegExp(`\"${metric}\"`));
  }

  assert.doesNotMatch(insights, /\"page_impressions(?:_unique)?\"/);
  assert.doesNotMatch(insights, /\"post_impressions(?:_unique)?\"/);
  assert.match(insights, /fetchPostMetricRowsResilient/);
  assert.match(stats, /t\("metric_unique_viewers"\)/);

  for (const permission of ["read_insights", "pages_read_engagement"]) {
    assert.match(facebook, new RegExp(permission));
  }
});
