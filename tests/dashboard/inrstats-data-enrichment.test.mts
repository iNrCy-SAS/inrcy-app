import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("website details expose users and CTR without replacing existing metrics", () => {
  const metrics = read("app/dashboard/stats/stats.shared.metrics.ts");
  assert.match(metrics, /pushMetric\(t\("metric_users"\), safeNum\(totals\.users\), \{ available: true \}\)/);
  assert.match(metrics, /pushMetric\(t\("metric_google_ctr"\), safeNum\(totals\.ctr\) \* 100, \{ available: true, keepZero: true/);
  assert.match(metrics, /return firstSix\(items\)/);
});

test("social and video details expose only provider-backed enrichment", () => {
  const metrics = read("app/dashboard/stats/stats.shared.metrics.ts");
  assert.match(metrics, /youtubeReportHasMetric\(m, "estimatedMinutesWatched"\)/);
  assert.match(metrics, /youtubeReportHasMetric\(m, "averageViewDuration"\)/);
  assert.match(metrics, /youtubeReportHasMetric\(m, "subscribersGained"\)/);
  assert.match(metrics, /youtubeReportHasMetric\(m, "subscribersLost"\)/);
  assert.match(metrics, /metricKeyExists\(m, \["newFollowers", "followerGainedFromContentCount", "organicFollowerCount", "paidFollowerCount"\]\)/);
  assert.match(metrics, /metricKeyExists\(m, \["postSaveCount"\]\)/);
  assert.match(metrics, /metricKeyExists\(m, \["postSendCount"\]\)/);
});

test("global connected count and navigation CTAs have explicit stable contracts", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const ui = read("app/dashboard/stats/stats.ui.tsx");
  const css = read("app/dashboard/stats/stats.module.css");

  assert.match(client, /isStatsModelConnected\(model\)/);
  assert.match(client, /connectedChannelsCount} \/ \$\{models\.length}/);
  assert.match(client, /allStatsNumbersReady \? `\$\{connectedChannelsCount}/);
  assert.doesNotMatch(client, /<b>\{models\.length}<\/b>/);
  assert.doesNotMatch(client, /<button type="button" className=\{styles\.allStatsChannelButton}/);
  assert.match(client, /models\[\(activeModelIndex - 1 \+ models\.length\) % models\.length\]/);
  assert.match(client, /models\[\(activeModelIndex \+ 1\) % models\.length\]/);
  assert.match(client, /className=\{styles\.channelStatsCycleButton\}/);
  assert.match(ui, /items\.length >= 5[\s\S]*?metricMiniGridDense/);
  assert.match(css, /\.metricMiniGrid\.metricMiniGridDense[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.allStatsDetailsButton,[\s\S]*?\.channelStatsBackButton[\s\S]*?#f59e0b[\s\S]*?#ec4899[\s\S]*?#7c3aed/);
  assert.match(css, /grid-template-columns: 30px minmax\(0, 1fr\) 30px/);
});

test("mail estimates use the common captured-leads shape and feed the global report", () => {
  const mailRoute = read("app/api/inrstats/mails/route.ts");
  const foundations = read("app/dashboard/stats/stats.client-foundations.ts");
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const report = read("app/api/agent/actions/send-stats-report/route.ts");

  assert.match(mailRoute, /from\("profiles"\)[\s\S]*?select\("lead_conversion_rate"\)/);
  assert.match(mailRoute, /capturedLeads,[\s\S]*?capturedLeadsEstimated: true/);
  assert.match(foundations, /capturedLeads: CapturedLeads/);
  assert.match(foundations, /stats\.capturedLeads\.week/);
  assert.match(client, /activeModel\.key === "mails"[\s\S]*?demandes_estimees_7j_30j_f40eb8d9/);
  assert.match(report, /capturedLeadsMonth: channelTotals\.capturedLeadsMonth \+ \(mail\?\.connectedCount \? mail\.capturedLeads\.month : 0\)/);
  assert.match(report, /"Demandes estim\."[\s\S]*?report\.mail\.capturedLeads\.month/);
});

test("new metric labels exist in every supported locale", () => {
  for (const locale of ["de-DE", "en-GB", "es-ES", "fr-FR", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const catalogue = JSON.parse(read(`messages/${locale}/stats.json`)) as Record<string, unknown>;
    for (const key of [
      "metric_new_followers",
      "metric_post_sends",
      "metric_subscriber_net",
      "metric_users",
      "metric_watch_time",
      "canal_precedent_65f40ce6",
      "canal_suivant_7b81611d",
      "demandes_estimees_7j_30j_f40eb8d9",
    ]) {
      assert.equal(typeof catalogue[key], "string", `${locale} misses ${key}`);
      assert.ok(String(catalogue[key]).trim(), `${locale}.${key} must not be empty`);
    }
  }
});
