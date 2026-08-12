import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSuccessfulInrSearchChannel,
  mergeInrSearchPublicationFeeds,
  type InrSearchFeedPublication,
} from "../../lib/inrSearchPublicationFeed.ts";

function publication(
  id: string,
  day: number,
  overrides: Partial<InrSearchFeedPublication> = {},
): InrSearchFeedPublication {
  return {
    id,
    title: `Titre ${id}`,
    content: `Texte ${id}`,
    imageUrl: null,
    videoUrl: null,
    videoMime: "video/mp4",
    videoThumbnailUrl: null,
    createdAt: `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    ...overrides,
  };
}

test("iNrSearch accepts successful Booster results and the durable success-channel fallback", () => {
  assert.equal(
    hasSuccessfulInrSearchChannel({
      results: { inr_search: { ok: true, status: "published" } },
    }),
    true,
  );
  assert.equal(
    hasSuccessfulInrSearchChannel({ channels: ["facebook", "inr_search"] }),
    true,
  );
  assert.equal(
    hasSuccessfulInrSearchChannel({
      channels: ["inr_search"],
      results: { inr_search: { ok: false, status: "failed" } },
    }),
    false,
  );
  assert.equal(
    hasSuccessfulInrSearchChannel({ attemptedChannels: ["inr_search"] }),
    false,
  );
  assert.equal(
    hasSuccessfulInrSearchChannel({
      channels: ["inr_search"],
      results: { inr_search: { status: "cancelled" } },
    }),
    false,
  );
});

test("the public feed deduplicates, keeps exact event text, recovers media and exposes the latest ten", () => {
  const durable = Array.from({ length: 12 }, (_, index) =>
    publication(`publication-${index + 1}`, index + 1),
  );
  durable[10] = publication("publication-11", 11, {
    imageUrl: "https://cdn.example.com/publication-11.png",
  });

  const primary = [
    publication("publication-11", 11, {
      title: "Texte exact iNrSearch",
      content: "Contenu exact sélectionné dans Booster",
    }),
  ];

  const merged = mergeInrSearchPublicationFeeds(primary, durable, 10);

  assert.equal(merged.length, 10);
  assert.equal(merged[0]?.id, "publication-12");
  assert.equal(merged.some((item) => item.id === "publication-1"), false);
  const recovered = merged.find((item) => item.id === "publication-11");
  assert.equal(recovered?.title, "Texte exact iNrSearch");
  assert.equal(recovered?.content, "Contenu exact sélectionné dans Booster");
  assert.equal(
    recovered?.imageUrl,
    "https://cdn.example.com/publication-11.png",
  );
});
