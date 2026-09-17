import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { getImagePublicationWarning } from "../../lib/multiImagePublicationWarning.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

type CreatedLinkedInPayload = {
  content?: {
    multiImage?: { images?: Array<{ id: string }> };
    media?: { id?: string };
  };
};

async function loadLinkedInPublishModule() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "inrcy-linkedin-partial-carousel-"),
  );
  const source = (
    await fs.readFile(path.join(ROOT, "lib/linkedinPublish.ts"), "utf8")
  ).replace(
    '"@/lib/providerMediaFallbackPolicy"',
    '"./providerMediaFallbackPolicyStub.ts"',
  ).replace(
    '"@/lib/mediaRules"',
    '"./mediaRulesStub.ts"',
  );

  await Promise.all([
    fs.writeFile(path.join(tempDir, "linkedinPublish.ts"), source),
    fs.writeFile(
      path.join(tempDir, "providerMediaFallbackPolicyStub.ts"),
      "export function getProviderCreateFailureSafety() { return { safeTextFallback: true, requestMayHaveSucceeded: false }; }\n",
    ),
    fs.writeFile(
      path.join(tempDir, "mediaRulesStub.ts"),
      "export const INR_MEDIA_VIDEO_SOURCE_MAX_BYTES = 1024;\nexport const INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL = '1 Mo';\n",
    ),
  ]);

  return {
    loaded: await import(
      `${pathToFileURL(path.join(tempDir, "linkedinPublish.ts")).href}?t=${Date.now()}`
    ),
    tempDir,
  };
}

test("le bilan multi-images indique précisément le nombre de photos publiées", () => {
  assert.deepEqual(
    getImagePublicationWarning({
      channelLabel: "LinkedIn",
      expectedCount: 3,
      publishedCount: 2,
    }),
    {
      code: "published_with_partial_images",
      kind: "media_degraded",
      message:
        "LinkedIn a publié 2 photos sur 3. 1 photo n’a pas pu être jointe.",
      expectedCount: 3,
      publishedCount: 2,
    },
  );
});

test("une publication texte de secours signale qu'aucune photo n'est partie", () => {
  assert.deepEqual(
    getImagePublicationWarning({
      channelLabel: "X",
      expectedCount: 3,
      publishedCount: 0,
    }),
    {
      code: "published_without_image",
      kind: "media_degraded",
      message:
        "X a publié le texte, mais aucune des 3 photos n’a pu être jointe.",
      expectedCount: 3,
      publishedCount: 0,
    },
  );
});

test("LinkedIn conserve les deux images valides sur trois dans un post multi-images", async (t) => {
  const { loaded, tempDir } = await loadLinkedInPublishModule();
  t.after(async () => fs.rm(tempDir, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  let initialized = 0;
  let createdPayload: CreatedLinkedInPayload = {};
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/rest/images?action=initializeUpload")) {
      initialized += 1;
      return Response.json({
        value: {
          uploadUrl: `https://upload.linkedin.test/${initialized}`,
          image: `urn:li:image:${initialized}`,
        },
      });
    }
    if (url === "https://images.test/2.jpg") {
      return new Response("introuvable", { status: 404 });
    }
    if (url.startsWith("https://images.test/")) {
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (url.startsWith("https://upload.linkedin.test/")) {
      return new Response("", { status: 201 });
    }
    if (url === "https://api.linkedin.com/rest/posts") {
      createdPayload = JSON.parse(String(init?.body || "{}"));
      return new Response("{}", {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:123" },
      });
    }
    return new Response("unexpected", { status: 500 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await loaded.linkedinPublishMultiImage({
    accessToken: "token",
    authorUrn: "urn:li:person:1",
    text: "Publication test",
    imageUrls: [
      "https://images.test/1.jpg",
      "https://images.test/2.jpg",
      "https://images.test/3.jpg",
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.requestedImageCount, 3);
  assert.equal(result.publishedImageCount, 2);
  assert.equal(result.failedImageCount, 1);
  assert.deepEqual(
    createdPayload.content?.multiImage?.images?.map((image) => image.id),
    ["urn:li:image:1", "urn:li:image:3"],
  );
});

test("LinkedIn publie l'unique photo valide au lieu de refuser tout le lot", async (t) => {
  const { loaded, tempDir } = await loadLinkedInPublishModule();
  t.after(async () => fs.rm(tempDir, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  let initialized = 0;
  let createdPayload: CreatedLinkedInPayload = {};
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/rest/images?action=initializeUpload")) {
      initialized += 1;
      return Response.json({
        value: {
          uploadUrl: `https://upload.linkedin.test/${initialized}`,
          image: `urn:li:image:${initialized}`,
        },
      });
    }
    if (url === "https://images.test/1.jpg") {
      return new Response(Uint8Array.from([1]), {
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (url.startsWith("https://images.test/")) {
      return new Response("refusée", { status: 422 });
    }
    if (url.startsWith("https://upload.linkedin.test/")) {
      return new Response("", { status: 201 });
    }
    if (url === "https://api.linkedin.com/rest/posts") {
      createdPayload = JSON.parse(String(init?.body || "{}"));
      return new Response("{}", {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:456" },
      });
    }
    return new Response("unexpected", { status: 500 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await loaded.linkedinPublishMultiImage({
    accessToken: "token",
    authorUrn: "urn:li:person:1",
    text: "Publication test",
    imageUrls: [
      "https://images.test/1.jpg",
      "https://images.test/2.jpg",
      "https://images.test/3.jpg",
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.publishedImageCount, 1);
  assert.equal(result.failedImageCount, 2);
  assert.equal(createdPayload?.content?.media?.id, "urn:li:image:1");
  assert.equal(createdPayload?.content?.multiImage, undefined);
});
