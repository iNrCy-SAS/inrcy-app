import assert from "node:assert/strict";
import test from "node:test";
import {
  INR_AGENT_DEFAULT_SETTINGS,
  type InrAgentAutomationSettings,
  type InrAgentFrequency,
  type InrAgentPublicationMediaTypes,
} from "../../lib/inrAgentSettings.ts";
import { inrAgentPublicationMediaAt } from "../../lib/inrAgentEditorialMediaPolicy.ts";
import {
  buildInrAgentEditorialPlan,
  getInrAgentEditorialPlanSignatures,
  type InrAgentEditorialSlot,
} from "../../lib/inrAgentEditorialPlanning.ts";

const both: InrAgentPublicationMediaTypes = { singleImage: true, video: true, carousel: true };
function automation(patch: Partial<InrAgentAutomationSettings> = {}): InrAgentAutomationSettings {
  return {
    ...structuredClone(INR_AGENT_DEFAULT_SETTINGS.automations.publish),
    enabled: true,
    frequency: "weekly",
    dayOfWeek: 1,
    time: "09:00",
    preferredMediaSource: "ai_generation",
    allowedChannels: ["facebook", "instagram", "youtube"],
    publicationMediaTypes: both,
    ...patch,
  };
}

function planned(automation: InrAgentAutomationSettings, now = "2026-01-01T00:00:00Z", horizonDays = 15) {
  return buildInrAgentEditorialPlan({ automation, timezone: "Europe/Paris", now: new Date(now), horizonDays });
}

function assertMix(slots: { mediaKind: string; imageCount: number; videoDurationSeconds?: number }[]) {
  assert.equal(slots.length, 10);
  assert.equal(slots.filter((slot) => slot.imageCount === 1).length, 7);
  assert.equal(slots.filter((slot) => slot.imageCount === 3).length, 2);
  assert.equal(slots.filter((slot) => slot.mediaKind === "video").length, 1);
  for (const slot of slots) {
    assert.equal(slot.videoDurationSeconds, slot.mediaKind === "video" ? 8 : undefined);
    assert.equal(slot.mediaKind, slot.imageCount === 0 ? "video" : "image");
  }
}

test("chaque cycle de dix préparations respecte les choix explicites et les vidéos de huit secondes", () => {
  for (const start of [1, 4, 8, 9, 10, 101]) {
    assertMix(Array.from({ length: 10 }, (_, index) => inrAgentPublicationMediaAt(start + index, both)));
  }
  for (const raw of [undefined, null, {}, { singleImage: false }, { video: "true", carousel: 1 }]) {
    for (let sequence = 1; sequence <= 20; sequence += 1) {
      assert.deepEqual(inrAgentPublicationMediaAt(sequence, raw), { mediaKind: "image", imageCount: 1 });
    }
  }
  assert.deepEqual(inrAgentPublicationMediaAt(10, { ...both, video: false }), { mediaKind: "image", imageCount: 1 });
  assert.deepEqual(inrAgentPublicationMediaAt(4, { ...both, carousel: false }), { mediaKind: "image", imageCount: 1 });
  assert.equal(inrAgentPublicationMediaAt(10, { ...both, carousel: false }).mediaKind, "video");
  assert.equal(inrAgentPublicationMediaAt(8, { ...both, video: false }).imageCount, 3);
  for (const invalid of [NaN, Infinity, -1, 0]) {
    assert.deepEqual(inrAgentPublicationMediaAt(invalid, both), { mediaKind: "image", imageCount: 1 });
  }
});

test("le défaut produit une seule image pour chaque source et ne force jamais YouTube en vidéo", () => {
  for (const preferredMediaSource of ["media_library", "image_bank", "ai_generation"] as const) {
    const config = automation({ preferredMediaSource, publicationMediaTypes: undefined });
    const slots = planned(config, undefined, 30);
    assert.ok(slots.length > 0);
    assert.ok(slots.every((slot) => slot.mediaKind === "image" && slot.imageCount === 1 && !slot.channels.includes("youtube")));
    const youtubeOnly = planned({ ...config, allowedChannels: ["youtube"] });
    assert.ok(youtubeOnly.every((slot) => slot.mediaKind === "image" && slot.channels.length === 0));
  }
});

test("un créneau conserve son format entre horizons de sept, quinze et trente jours", () => {
  const config = automation({ frequency: "three_times_weekly" });
  const complete = new Map(planned(config, "2026-03-20T00:00:00Z", 30).map((slot) => [slot.slotKey, slot]));
  for (const now of ["2026-03-20T00:00:00Z", "2026-03-24T11:30:00Z", "2026-03-30T00:00:00Z"]) {
    for (const horizon of [7, 15, 30]) {
      for (const slot of planned(config, now, horizon)) {
        const original = complete.get(slot.slotKey);
        if (!original) continue;
        assert.deepEqual([slot.mediaKind, slot.imageCount, slot.videoDurationSeconds, slot.channels],
          [original.mediaKind, original.imageCount, original.videoDurationSeconds, original.channels]);
      }
    }
  }
  assert.ok([...complete.values()].some((slot) => slot.mediaKind === "video"));
});

test("les horizons courts successifs réalisent aussi le mix pour toutes les fréquences", () => {
  for (const frequency of ["weekly", "twice_weekly", "three_times_weekly", "biweekly", "three_times_monthly", "monthly", "quarterly"] as InrAgentFrequency[]) {
    const config = automation({ frequency });
    const unique = new Map<string, InrAgentEditorialSlot>();
    // Short rolling windows; no single window needs to contain ten publications.
    for (let month = 0; month < 32 && unique.size < 12; month += 1) {
      for (const day of [1, 14, 27]) {
        const now = new Date(Date.UTC(2026, month, day)).toISOString();
        for (const slot of planned(config, now, 15)) unique.set(slot.slotKey, slot);
      }
    }
    const firstTen = [...unique.values()].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)).slice(0, 10);
    assertMix(firstTen);
    for (const slot of firstTen) assert.equal(slot.channels.includes("youtube"), slot.mediaKind === "video");
  }
});

test("le rang reste continu lorsque les dates de fin de mois fusionnent en février", () => {
  const config = automation({ frequency: "three_times_monthly", metadata: { monthDays: [29, 30, 31] } });
  const slots = new Map<string, InrAgentEditorialSlot>();
  for (let month = 0; month < 6; month += 1) {
    for (const slot of planned(config, new Date(Date.UTC(2026, month, 20)).toISOString(), 15)) slots.set(slot.slotKey, slot);
  }
  const ordered = [...slots.values()].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  assert.equal(ordered.filter((slot) => slot.scheduledFor.startsWith("2026-02")).length, 1);
  assertMix(ordered.slice(0, 10));
  assertMix(ordered.slice(1, 11));
});

test("le tri des jours et le passage heure d’été conservent une série stable", () => {
  const metadata = { scheduleSlots: [
    { dayOfWeek: 5, time: "18:00" },
    { dayOfWeek: 1, time: "09:00" },
    { dayOfWeek: 3, time: "09:00" },
  ] };
  const config = automation({ frequency: "three_times_weekly", metadata });
  const first = planned(config, "2026-03-01T00:00:00Z", 30);
  const reordered = planned({ ...config, metadata: { scheduleSlots: [...metadata.scheduleSlots].reverse() } }, "2026-03-01T00:00:00Z", 30);
  assertMix(first.slice(0, 10));
  assert.deepEqual(first.map((slot) => [slot.slotKey, slot.mediaKind, slot.imageCount]), reordered.map((slot) => [slot.slotKey, slot.mediaKind, slot.imageCount]));
  const before = planned(config, "2026-03-20T00:00:00Z", 30);
  const after = planned(config, "2026-03-30T00:00:00Z", 15);
  for (const slot of after) {
    const same = before.find((candidate) => candidate.slotKey === slot.slotKey);
    assert.ok(same);
    assert.equal(slot.mediaKind, same.mediaKind);
    assert.equal(slot.imageCount, same.imageCount);
  }
});

test("désactiver les options conserve la signature historique et les activer ne change pas les thèmes", () => {
  const config = automation({ publicationMediaTypes: { singleImage: true, video: false, carousel: false } });
  const expectedCriteria = [config.allowedChannels, config.allowedThemes, config.preferredMediaSource, config.useImageBank,
    config.imageRequired, "professional"].map((part) => JSON.stringify(part)).join("|");
  const original = getInrAgentEditorialPlanSignatures({ automation: config, timezone: "Europe/Paris" });
  assert.equal(original.criteriaSignature, expectedCriteria);
  const oldRecord = { ...config, publicationMediaTypes: undefined };
  assert.deepEqual(getInrAgentEditorialPlanSignatures({ automation: oldRecord, timezone: "Europe/Paris" }), original);
  const reference = planned(config, undefined, 30);
  for (const formats of [both, { ...both, video: false }, { ...both, carousel: false }]) {
    const changed = { ...config, publicationMediaTypes: formats };
    const signatures = getInrAgentEditorialPlanSignatures({ automation: changed, timezone: "Europe/Paris" });
    assert.equal(signatures.scheduleSignature, original.scheduleSignature);
    assert.notEqual(signatures.criteriaSignature, original.criteriaSignature);
    assert.deepEqual(planned(changed, undefined, 30).map((slot) => [slot.slotKey, slot.sequence, slot.theme, slot.tone]),
      reference.map((slot) => [slot.slotKey, slot.sequence, slot.theme, slot.tone]));
  }
});
