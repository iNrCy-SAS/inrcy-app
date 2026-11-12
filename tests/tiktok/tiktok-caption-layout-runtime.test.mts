import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const load = runtimeModules({ "@/lib/tiktokOAuth": { fetchTiktokCreatorInfo: async () => ({ privacy_level_options: ["SELF_ONLY"] }) } });
const cta = load<typeof import("../../lib/boosterCta.ts")>("lib/boosterCta.ts");
const preview = load<typeof import("../../lib/boosterPublicationTextPreview.ts")>("lib/boosterPublicationTextPreview.ts");
const publisher = load<typeof import("../../lib/tiktokPublish.ts")>("lib/tiktokPublish.ts");
const paragraphs = "Première idée.\n\nDeuxième idée.\n\nTroisième idée.";

test("TikTok captions retain CR-only and CRLF paragraphs when structured contact cleanup runs", () => {
  for (const ending of ["\r", "\r\n", "\n"]) {
    const content = paragraphs.replaceAll("\n", ending);
    for (const mode of ["none", "website", "call"]) {
      const post = { content, ctaMode: mode, ctaUrl: "https://example.com", ctaPhone: "0612345678", hashtags: [] };
      assert.ok(cta.buildBoosterMessage("tiktok", post).startsWith(paragraphs), `${mode} must preserve ${JSON.stringify(ending)} paragraphs`);
      assert.ok(preview.getBoosterPublicationTextPreview("tiktok", post).text.startsWith(paragraphs));
    }
  }
});

test("TikTok photo Direct Post sends paragraph breaks verbatim in post_info.description", async t => {
  const previous = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith("https://open.tiktokapis.com/"), "test transport must not call any other provider");
    if (url.includes("/content/init/")) {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { publish_id: "fixture-publish" }, error: { code: "ok" } });
    }
    return Response.json({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["fixture-post"] }, error: { code: "ok" } });
  };
  const description = cta.buildBoosterMessage("tiktok", { content: paragraphs.replaceAll("\n", "\r"), ctaMode: "website", ctaUrl: "https://example.com" });
  const result = await publisher.tiktokDirectPostPhotos({ accessToken: "fixture-token", imageUrls: ["https://fixture.invalid/photo.jpg"], title: "Titre", description,
    publicationSettings: { privacyLevel: "SELF_ONLY", musicUsageConfirmed: true, commercialContent: "none", allowComments: false, allowDuo: false, allowStitch: false, aiContent: false, photoAutoMusic: false } });
  assert.equal(result.ok, true);
  assert.equal((bodies[0].post_info as { description: string }).description, description);
  assert.ok(description.startsWith(paragraphs));
});
