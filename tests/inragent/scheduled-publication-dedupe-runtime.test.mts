import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";

const { findSimilarScheduledPublication, findSimilarUpcomingScheduledPublication } = runtimeModules()<typeof import("../../lib/scheduledPublicationDedupe.ts")>("lib/scheduledPublicationDedupe.ts");
type Payload = Record<string, unknown>;
type Row = Record<string, unknown> & { id: string; user_id: string; channels: string[]; payload: Payload; status: string; scheduled_at: string };
const actor = "11111111-1111-4111-8111-111111111111";
const now = "2026-11-16T13:15:00.000Z", slot = "2026-11-16T13:30:00.000Z";

function post(title: string, content: string, extra: Payload = {}): Payload {
  return { channels: ["facebook", "instagram"], post: { title, content }, ...extra };
}
const exportPost = () => post("Préparer un export", "Préciser les marchandises, les volumes et la destination de son projet.");
const tradePost = () => post("Les échanges commerciaux", "Découvrir les infrastructures et les échanges autour de la ville portuaire.");
function scheduled(payload: Payload, extra: Payload = {}): Row {
  return { id: "scheduled-one", user_id: actor, title: "Publication multicanale", channels: ["facebook", "instagram"], payload: { publishPayload: payload }, status: "scheduled", scheduled_at: slot,
    action_type: "publication", target_tool: "booster", ...extra };
}
function database(rows: Row[]) {
  return { from(table: string) {
    assert.equal(table, "inr_agent_scheduled_actions");
    const filters: Array<(row: Row) => boolean> = [];
    return {
      select() { return this; },
      eq(field: string, value: unknown) { filters.push(row => row[field] === value); return this; },
      in(field: string, values: unknown[]) { filters.push(row => values.includes(row[field])); return this; },
      gte(field: string, value: string) { filters.push(row => String(row[field]) >= value); return this; },
      lte(field: string, value: string) { filters.push(row => String(row[field]) <= value); return this; },
      async limit(count: number) { return { data: rows.filter(row => filters.every(matches => matches(row))).slice(0, count), error: null }; },
    };
  } };
}
async function check(payload: Payload, existing: Row[], immediate: boolean) {
  const common = { supabase: database(existing), userId: actor, channels: ["facebook", "instagram"], payload };
  return immediate
    ? findSimilarUpcomingScheduledPublication({ ...common, nowIso: now })
    : findSimilarScheduledPublication({ ...common, scheduledAt: slot });
}

test("distinct Meta texts without media do not become duplicates just because both target the feed", async () => {
  for (const immediate of [false, true]) {
    const result = await check(exportPost(), [scheduled(tradePost())], immediate);
    assert.equal(result.duplicate, false);
  }
});

test("empty media placeholders and duration-only objects do not invent an asset identity", async () => {
  for (const placeholder of [{}, { name: "", size: 0 }, { duration: 8 }, { bytes: 120 }]) {
    for (const immediate of [false, true]) {
      const result = await check({ ...exportPost(), images: [placeholder] }, [scheduled({ ...tradePost(), images: [placeholder] })], immediate);
      assert.equal(result.duplicate, false, JSON.stringify({ immediate, placeholder }));
    }
  }
});

test("identical text and genuine reused assets still trigger both duplicate guards", async () => {
  for (const immediate of [false, true]) {
    const identical = await check(exportPost(), [scheduled(exportPost())], immediate);
    assert.equal(identical.duplicate, true);
    assert.deepEqual(identical.overlappingChannels, ["facebook", "instagram"]);
    for (const image of [{ storagePath: "account/media/same-file.jpg" }, { name: "uploaded-image.jpg", size: 12800 }]) {
      const sameAsset = await check({ ...exportPost(), images: [image] }, [scheduled({ ...tradePost(), images: [image] })], immediate);
      assert.equal(sameAsset.duplicate, true);
    }
  }
});

test("placement distinguishes genuine media uses while media fallback is still checked", async () => {
  const asset = { path: "account/media/same-file.jpg" };
  const classic = { primaryPlacement: "classic", includeStory: false };
  const story = { primaryPlacement: "story", includeStory: false };
  for (const immediate of [false, true]) {
    const current = { ...exportPost(), media: asset, facebookPublicationSettings: story, instagramPublicationSettings: story };
    const existing = { ...tradePost(), media: asset, facebookPublicationSettings: classic, instagramPublicationSettings: classic };
    assert.equal((await check(current, [scheduled(existing)], immediate)).duplicate, false);
    assert.equal((await check({ ...current, facebookPublicationSettings: classic, instagramPublicationSettings: classic }, [scheduled(existing)], immediate)).duplicate, true);
  }
});

test("duplicate reads remain account-scoped and ignore terminal or distant scheduled actions", async () => {
  for (const immediate of [false, true]) {
    const rows = [scheduled(exportPost(), { user_id: "other-account" }), scheduled(exportPost(), { status: "done" }), scheduled(exportPost(), { scheduled_at: "2026-12-16T13:30:00Z" })];
    assert.equal((await check(exportPost(), rows, immediate)).duplicate, false);
  }
  assert.equal((await findSimilarScheduledPublication({ supabase: database([scheduled(exportPost())]), userId: actor, channels: ["facebook"], payload: exportPost(), scheduledAt: slot, excludeId: "scheduled-one" })).duplicate, false);
});
