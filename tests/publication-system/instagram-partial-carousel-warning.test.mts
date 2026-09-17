import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { getInstagramPartialImagesWarning } from "../../lib/instagramPartialImagesWarning.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

async function loadInstagramPublishModule() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "inrcy-instagram-partial-carousel-"),
  );
  const sourcePath = path.join(ROOT, "lib/instagramPublish.ts");
  const source = (await fs.readFile(sourcePath, "utf8"))
    .replace('"@/lib/metaGraphApi"', '"./metaGraphApiStub.ts"')
    .replace(
      '"@/lib/metaGraphErrorClassification"',
      '"./metaGraphErrorClassificationStub.ts"',
    );

  await Promise.all([
    fs.writeFile(path.join(tempDir, "instagramPublish.ts"), source),
    fs.writeFile(
      path.join(tempDir, "metaGraphApiStub.ts"),
      'export function buildMetaGraphUrl(value: string) { return `https://graph.instagram.test/v25.0/${value}`; }\n',
    ),
    fs.writeFile(
      path.join(tempDir, "metaGraphErrorClassificationStub.ts"),
      "export function isMetaAuthorizationError() { return false; }\nexport function isMetaRateLimitError() { return false; }\n",
    ),
  ]);

  const moduleUrl = `${pathToFileURL(path.join(tempDir, "instagramPublish.ts")).href}?t=${Date.now()}`;
  return { loaded: await import(moduleUrl), tempDir };
}

test("Instagram reports one published photo out of a three-photo carousel", () => {
  assert.deepEqual(
    getInstagramPartialImagesWarning({ expectedCount: 3, publishedCount: 1 }),
    {
      code: "published_with_partial_images",
      kind: "media_degraded",
      message:
        "Instagram a publié 1 photo sur 3. 2 photos n’ont pas pu être jointes.",
      expectedCount: 3,
      publishedCount: 1,
    },
  );
});

test("Instagram does not report a warning when the full carousel is published", () => {
  assert.equal(
    getInstagramPartialImagesWarning({ expectedCount: 3, publishedCount: 3 }),
    null,
  );
});

test("Instagram reports a two-photo carousel when one of three photos is rejected", () => {
  assert.deepEqual(
    getInstagramPartialImagesWarning({ expectedCount: 3, publishedCount: 2 }),
    {
      code: "published_with_partial_images",
      kind: "media_degraded",
      message:
        "Instagram a publié 2 photos sur 3. 1 photo n’a pas pu être jointe.",
      expectedCount: 3,
      publishedCount: 2,
    },
  );
});

test("the partial warning never turns a total media failure into a success", () => {
  assert.equal(
    getInstagramPartialImagesWarning({ expectedCount: 3, publishedCount: 0 }),
    null,
  );
});

test("Instagram publishes the two valid photos when one carousel item is rejected", async (t) => {
  const { loaded, tempDir } = await loadInstagramPublishModule();
  t.after(async () => fs.rm(tempDir, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const isMediaCreate = url.pathname.endsWith("/ig-1/media");
    const imageUrl = url.searchParams.get("image_url");

    if (isMediaCreate && imageUrl === "https://images.test/1.jpg") {
      return Response.json({ id: "child-1" });
    }
    if (isMediaCreate && imageUrl === "https://images.test/2.jpg") {
      return Response.json(
        { error: { message: "Photo 2 refusée" } },
        { status: 400 },
      );
    }
    if (isMediaCreate && imageUrl === "https://images.test/3.jpg") {
      return Response.json({ id: "child-3" });
    }
    if (
      isMediaCreate &&
      url.searchParams.get("media_type") === "CAROUSEL"
    ) {
      assert.equal(url.searchParams.get("children"), "child-1,child-3");
      return Response.json({ id: "carousel-container" });
    }
    if (
      ["child-1", "child-3", "carousel-container"].some((id) =>
        url.pathname.endsWith(`/${id}`),
      )
    ) {
      return Response.json({ status_code: "FINISHED" });
    }
    if (url.pathname.endsWith("/ig-1/media_publish")) {
      return Response.json({ id: "instagram-post" });
    }
    if (url.pathname.endsWith("/instagram-post")) {
      return Response.json({
        id: "instagram-post",
        children: { data: [{ id: "media-1" }, { id: "media-3" }] },
      });
    }

    return Response.json(
      { error: { message: `Unexpected URL: ${url.toString()}` } },
      { status: 500 },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  const result = await loaded.instagramPublishImagesBestEffortWithTokenFallback({
    igUserId: "ig-1",
    accessToken: "token",
    caption: "Test",
    imageUrls: [
      "https://images.test/1.jpg",
      "https://images.test/2.jpg",
      "https://images.test/3.jpg",
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mediaType, "CAROUSEL_ALBUM");
  assert.equal(result.requestedImageCount, 3);
  assert.equal(result.publishedImageCount, 2);
  assert.deepEqual(result.childContainerIds, ["child-1", "child-3"]);
});
