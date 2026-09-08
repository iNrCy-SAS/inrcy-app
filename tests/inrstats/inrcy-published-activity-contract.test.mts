import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const shared = read("lib/stats/buildOverview.shared.ts");
const activity = read("lib/stats/buildOverview.activity.ts");
const connections = read("lib/stats/buildOverview.connections.ts");

test("published activity exposes exact 7-day, 30-day, 365-day and total windows", () => {
  assert.match(
    shared,
    /export type InrcyWindowCount = \{[\s\S]*?week: number;[\s\S]*?month: number;[\s\S]*?year: number;[\s\S]*?total: number;[\s\S]*?\};/,
  );
  assert.match(shared, /return \{ week: 0, month: 0, year: 0, total: 0 \};/);
  assert.match(shared, /const yearMs = 365 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(shared, /deltaMs <= yearMs\) counter\.year \+= amount;/);
});

test("publication types stay normalized and every successful event increments one typed window", () => {
  for (const type of [
    "text",
    "image",
    "video",
    "classic",
    "reel",
    "story",
    "short",
    "pin",
    "unknown",
  ]) {
    assert.match(shared, new RegExp(`\\| "${type}"`));
  }

  assert.match(
    shared,
    /publicationTypes: Partial<Record<InrcyPublicationType, InrcyWindowCount>>;/,
  );
  assert.match(activity, /const publicationType = inferPublicationTypeForChannel\(payload, channel\);/);
  assert.match(
    activity,
    /stats\.publicationTypes\[publicationType\] = publicationTypeCount;[\s\S]*?incrementWindowCount\(publicationTypeCount, createdAtMs, nowMs\);/,
  );
});

test("channel-specific typing never guesses an unexposed historical format", () => {
  assert.match(shared, /if \(channel === "pinterest"\) return "pin";/);
  assert.match(
    shared,
    /if \(channel === "youtube_shorts"\) \{[\s\S]*?return inferYoutubePublicationType\(payload\) \|\| "unknown";/,
  );
  assert.match(shared, /if \(channel === "facebook" \|\| channel === "instagram"\)/);
  assert.match(shared, /const placement = inferExplicitMetaPlacement\(payload, channel\);/);
  assert.match(shared, /if \(mediaKind === "none"\) return "text";/);
  assert.match(shared, /if \(mediaKind === "photos"\) return "image";/);
  assert.match(shared, /if \(mediaKind === "video"\) return "video";/);
  assert.match(shared, /return "unknown";/);
  assert.match(
    shared,
    /function inferYoutubePublicationType\([\s\S]*?if \(Number\.isFinite\(duration\) && duration > 0 && duration <= 180\) return "short";[\s\S]*?return null;/,
  );
  assert.match(
    shared,
    /inferYoutubeVideoPublicationKind\([\s\S]*?\): "short" \| "long" \| "unknown"[\s\S]*?return "unknown";/,
  );
  assert.match(
    activity,
    /if \(youtubeKind === "long"\)[\s\S]*?else if \(youtubeKind === "short"\)[\s\S]*?incrementWindowCount\(stats\.videos/,
  );
});

test("activity recognizes inR Search and both persisted iNrCy site aliases", () => {
  assert.match(shared, /export type InrcyActivityChannelKey = OverviewCubeKey \| "inr_search";/);
  assert.match(
    shared,
    /export const INRCY_PUBLISHABLE_CHANNELS: InrcyActivityChannelKey\[\] = \[[\s\S]*?"site_inrcy",[\s\S]*?"inr_search",/,
  );
  assert.match(shared, /channel === "inrcy_site" \? "site_inrcy" : channel/);
  assert.match(
    shared,
    /channel === "site_inrcy" \? \["site_inrcy", "inrcy_site"\] : \[channel\]/,
  );
});

test("the 5,000-row history cap is explicit and unavailable history is not converted to zeros", () => {
  assert.match(activity, /const INRCY_ACTIVITY_ROW_LIMIT = 5000;/);
  assert.match(activity, /\.limit\(INRCY_ACTIVITY_ROW_LIMIT \+ 1\);/);
  assert.match(
    activity,
    /const publicationHistoryComplete = data\.length <= INRCY_ACTIVITY_ROW_LIMIT;/,
  );
  assert.match(activity, /const rows = data\.slice\(0, INRCY_ACTIVITY_ROW_LIMIT\);/);
  assert.match(activity, /stats\.publicationHistoryComplete = publicationHistoryComplete;/);
  assert.match(activity, /if \(error \|\| !Array\.isArray\(data\)\) return \{\};/);
  assert.match(activity, /catch \{[\s\S]*?return \{\};[\s\S]*?\}/);
});

test("the cache key invalidates V1 and fingerprints every new publication field deterministically", () => {
  assert.match(connections, /statsVersion:inrcyPublishedActivityV2/);
  assert.doesNotMatch(connections, /statsVersion:inrcyPublishedActivityV1/);
  assert.match(
    connections,
    /const INRCY_PUBLICATION_TYPE_KEYS = \[[\s\S]*?"text",[\s\S]*?"unknown",[\s\S]*?\] as const/,
  );
  assert.match(
    connections,
    /value\?\.week \?\? 0,[\s\S]*?value\?\.month \?\? 0,[\s\S]*?value\?\.year \?\? 0,[\s\S]*?value\?\.total \?\? 0/,
  );
  assert.match(
    connections,
    /INRCY_PUBLICATION_TYPE_KEYS\.map\([\s\S]*?publicationTypes\?\.\[type\]/,
  );
  assert.match(connections, /stats\.publicationHistoryComplete/);
  assert.match(connections, /\? "complete"[\s\S]*?: "truncated"[\s\S]*?: "unavailable"/);
  assert.match(connections, /types=\$\{publicationTypes \? "available" : "unavailable"\}/);
});
