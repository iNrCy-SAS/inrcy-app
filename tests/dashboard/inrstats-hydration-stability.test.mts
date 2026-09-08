import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatStableStatsValue,
  hasCommittedStatsSnapshot,
  isLatestStatsRequest,
} from "../../app/dashboard/stats/stats.client-stability.ts";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("iNrStats exposes numbers only after a real snapshot has been committed", () => {
  assert.equal(hasCommittedStatsSnapshot({ loading: true, syncedAt: 123 }), false);
  assert.equal(hasCommittedStatsSnapshot({ loading: false }), false);
  assert.equal(hasCommittedStatsSnapshot({ loading: false, syncedAt: 0 }), false);
  assert.equal(hasCommittedStatsSnapshot({ loading: false, syncedAt: Number.NaN }), false);
  assert.equal(hasCommittedStatsSnapshot({ loading: false, syncedAt: 123 }), true);

  assert.equal(
    formatStableStatsValue({ ready: false, value: "285", prefix: "+" }),
    "—",
  );
  assert.equal(
    formatStableStatsValue({ ready: true, value: "5 700", prefix: "+", suffix: " €" }),
    "+5 700 €",
  );
});

test("an older or cross-account response cannot replace the latest Stats snapshot", () => {
  assert.equal(isLatestStatsRequest({
    requestSeq: 4,
    latestRequestSeq: 5,
    requestAccountScope: "account-a",
    activeAccountScope: "account-a",
  }), false);
  assert.equal(isLatestStatsRequest({
    requestSeq: 5,
    latestRequestSeq: 5,
    requestAccountScope: "account-a",
    activeAccountScope: "account-b",
  }), false);
  assert.equal(isLatestStatsRequest({
    requestSeq: 5,
    latestRequestSeq: 5,
    requestAccountScope: "account-a",
    activeAccountScope: "account-a",
  }), true);
});

test("StatsClient first render is deterministic and never reads browser caches in state initializers", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const initialSearchStart = client.indexOf("const [inrSearchStats");
  const initialSearchEnd = client.indexOf("const [channelIdentityHints", initialSearchStart);
  const initialSearch = client.slice(initialSearchStart, initialSearchEnd);

  assert.match(client, /useState<MailStatsSnapshot>\(EMPTY_MAIL_STATS\)/);
  assert.match(client, /useState<CachedChannelConnectivity>\(\{\}\)/);
  assert.match(initialSearch, /\.\.\.EMPTY_INR_SEARCH_STATS/);
  assert.doesNotMatch(initialSearch, /loading:\s*false/);
  assert.doesNotMatch(client, /useBrowserLayoutEffect|buildInitialMailStatsSnapshot/);
  assert.doesNotMatch(client, /useState[^;]*readCached/);
});

test("only a complete current-day cache can hydrate the bulk Stats state", () => {
  const hooks = read("app/dashboard/stats/stats.client-hooks.ts");

  assert.match(
    hooks,
    /const cubeFresh = !!cachedCube\?\.overviews && cachedCube\.syncedAt >= lastChannelSyncAt && cachedCube\.snapshotDate === expectedSnapshotDate/,
  );
  assert.match(
    hooks,
    /const summaryFresh = !!cachedSummary && cachedSummary\.syncedAt >= lastChannelSyncAt && cachedSummary\.snapshotDate === expectedSnapshotDate/,
  );
  assert.match(hooks, /if \(!cubeFresh \|\| !cubeBlocksFresh \|\| !summaryFresh\) return false/);
  assert.doesNotMatch(hooks, /if \(cached && cachedSummary && hasFreshCapturedLeads\)/);
  assert.doesNotMatch(hooks, /hydrateMailStatsFromCache/);
});

test("the first visible Stats values stay pending until every required source is coherent", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const hooks = read("app/dashboard/stats/stats.client-hooks.ts");
  const ui = read("app/dashboard/stats/stats.ui.tsx");

  assert.match(client, /const \[summaryHydrated, setSummaryHydrated\] = useState\(false\)/);
  assert.match(client, /const allStatsNumbersReady = bulkStatsReady && inrBadgeStatsReady && inrSearchStatsReady && mailStatsReady/);
  assert.match(client, /stableOpportunity\(centralPotential30, allStatsNumbersReady\)/);
  assert.match(client, /stableRevenue\([\s\S]*?allStatsNumbersReady\)/);
  assert.match(client, /aria-busy=\{!allStatsNumbersReady\}/);
  assert.match(ui, /statsReady \? `\+\$\{formatInt\(model\.opportunity30\)\}` : "—"/);
  assert.match(ui, /detailsOpen && statsReady \? \(/);
  assert.doesNotMatch(hooks, /setSummaryOpp\(\(prev\) => \(\{ \.\.\.prev, loading: true \}\)\)/);

  for (const requestRef of [
    "inrBadgeStatsRequestSeqRef",
    "inrSearchStatsRequestSeqRef",
    "mailStatsRequestSeqRef",
  ]) {
    assert.match(hooks, new RegExp(`const ${requestRef} = useRef\\(0\\)`));
    assert.match(hooks, new RegExp(`isCurrentStatsResponse\\(requestSeq, ${requestRef}\\.current, requestAccountScope\\)`));
  }
});
