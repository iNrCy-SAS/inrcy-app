import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import {
  countPinterestCharacters,
  getPinterestTextIssues,
  PinterestTextValidationError,
  preparePinterestPinText,
} from "../../lib/pinterestTextLimits.ts";

const { buildPinterestPublicationText } = runtimeModules()<typeof import("../../lib/pinterestTextRules.ts")>("lib/pinterestTextRules.ts");

test("Pinterest accepts the complete 800-character description and 100-character title, counting Unicode code points", () => {
  for (const unit of ["a", "é", "😀"]) {
    const title = unit.repeat(100), description = unit.repeat(800);
    assert.deepEqual(preparePinterestPinText(title, description), { title, description });
    assert.equal(countPinterestCharacters(description), 800);
    assert.deepEqual(getPinterestTextIssues(title, description), []);
    assert.throws(() => preparePinterestPinText(title, `${description}${unit}`), PinterestTextValidationError);
    assert.throws(() => preparePinterestPinText(`${title}${unit}`, description), PinterestTextValidationError);
  }
  const [issue] = getPinterestTextIssues("Titre", "a".repeat(842));
  assert.equal(issue.excess, 42);
  assert.equal(issue.code, "pinterest_description_too_long");
  assert.match(issue.message, /42 caractères/);
});

test("Pinterest validates the full edited description including title, CTA and selected hashtags without dropping text", () => {
  const post = { title: "Titre", content: "a".repeat(740), ctaMode: "call", ctaPhone: "+33123456789", cta: "Appelez-nous", hashtags: ["renovation", "travaux"] };
  const built = buildPinterestPublicationText(post);
  assert.match(built.description, /^Titre\n\n/);
  assert.match(built.description, /Appelez-nous : \+33 1 23 45 67 89/);
  assert.match(built.description, /#renovation/);
  assert.match(built.description, /#travaux/);
  assert.equal(built.descriptionLength, countPinterestCharacters(built.description));
  const overflowing = buildPinterestPublicationText({ ...post, content: "a".repeat(795) });
  assert.ok(overflowing.issues.some(issue => issue.field === "description"));
  assert.ok(overflowing.description.includes("a".repeat(795)), "the professional's content is never shortened");
  assert.ok(overflowing.description.includes("#travaux"), "selected hashtags are not silently removed to fit");
  const creation = buildPinterestPublicationText({ title: "Titre séparé", content: "Description", ctaMode: "none" }, undefined, { includeTitle: false });
  assert.equal(creation.title, "Titre séparé");
  assert.equal(creation.description, "Description");
});

test("Pinterest publisher sends accepted descriptions beyond 500 intact and rejects overflow before media or provider work", async () => {
  let mediaPreparations = 0;
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: {} },
    "@/lib/pinterestOAuth": { getPinterestApiBaseUrl: () => "https://pinterest.example.test" },
    "@/lib/pinterestCarouselImages": { preparePinterestCarouselImages: async ({ imageUrls }: { imageUrls: string[] }) => { mediaPreparations++; return { imageUrls }; } },
  });
  const publisher = load<typeof import("../../lib/pinterestPublish.ts")>("lib/pinterestPublish.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/pinterest\.example\.test\/v5\/pins/);
    requests.push({ method: String(init?.method), body: JSON.parse(String(init?.body)) });
    return Response.json({ id: "12345" });
  };
  try {
    const copy = { title: "😀".repeat(100), description: "é".repeat(799) + "😀" };
    await publisher.createPinterestImagePin({ accessToken: "fixture-token", userId: "fixture-user", boardId: "123", ...copy, imageUrls: ["https://media.example.test/image.jpg"] });
    await publisher.updatePinterestPin({ accessToken: "fixture-token", pinId: "12345", ...copy });
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.body.title, copy.title);
      assert.equal(request.body.description, copy.description);
    }
    const before = mediaPreparations;
    await assert.rejects(() => publisher.createPinterestImagePin({ accessToken: "fixture-token", userId: "fixture-user", boardId: "123", title: "Titre", description: "a".repeat(801), imageUrls: ["https://media.example.test/image.jpg"] }), /trop longue de 1 caractère/);
    await assert.rejects(() => publisher.createPinterestVideoPin({ accessToken: "fixture-token", userId: "fixture-user", boardId: "123", title: "a".repeat(101), description: "Description", videoUrl: "https://media.example.test/video.mp4" }), /trop long de 1 caractère/);
    await assert.rejects(() => publisher.updatePinterestPin({ accessToken: "fixture-token", pinId: "12345", title: "Titre", description: "a".repeat(801) }), /trop longue de 1 caractère/);
    assert.equal(mediaPreparations, before);
    assert.equal(requests.length, 2, "all invalid copies are rejected before a provider request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
