import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  consumeInrSendPublicationEditorSnapshot,
  saveInrSendPublicationEditorSnapshot,
} from "../../app/dashboard/mails/_lib/mailboxStudioSnapshot.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

class MemorySessionStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class MemoryCache {
  values = new Map<string, Response>();

  async put(request: Request, response: Response) {
    this.values.set(request.url, response.clone());
  }

  async match(request: Request) {
    return this.values.get(request.url)?.clone();
  }

  async delete(request: Request) {
    return this.values.delete(request.url);
  }
}

test("iNrSend restaure toutes les modifications locales et leurs fichiers après iNrStudio", async () => {
  const sessionStorage = new MemorySessionStorage();
  const cache = new MemoryCache();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage,
      caches: { open: async () => cache },
    },
  });

  try {
    const sharedImage = new File([new Uint8Array([1, 2, 3, 4])], "local.png", {
      type: "image/png",
      lastModified: 123,
    });
    const localVideo = new File([new Uint8Array([5, 6, 7])], "local.mp4", {
      type: "video/mp4",
      lastModified: 456,
    });
    const defaultTransform = {
      fit: "cover" as const,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      blurBackground: false,
    };

    const key = await saveInrSendPublicationEditorSnapshot({
      itemId: "publication-item-42",
      channel: "instagram",
      form: {
        title: "Titre local non enregistré",
        content: "Contenu local modifié",
        cta: "Découvrir",
        ctaMode: "website",
        ctaUrl: "https://inrcy.com/local",
        ctaPhone: "",
        hashtags: "local studio",
      },
      imagesByChannel: {
        instagram: {
          assets: [
            {
              key: "image-local",
              name: sharedImage.name,
              type: sharedImage.type,
              previewUrl: "blob:ancienne-page/image-local",
              sourceUrl: null,
              originalUrl: null,
              file: sharedImage,
              selected: true,
              transform: { ...defaultTransform, zoom: 1.35, offsetX: 12 },
              savedTransform: defaultTransform,
              imageMeta: { width: 1200, height: 800, ratio: 1.5 },
            },
            {
              key: "image-distante",
              name: "distante.jpg",
              type: "image/jpeg",
              previewUrl: "https://cdn.example.com/distante.jpg",
              sourceUrl: "https://cdn.example.com/distante.jpg",
              originalUrl: "https://cdn.example.com/originale.jpg",
              file: null,
              selected: false,
              transform: defaultTransform,
            },
          ],
        },
        facebook: {
          assets: [
            {
              key: "image-locale-partagee",
              name: sharedImage.name,
              type: sharedImage.type,
              previewUrl: "blob:ancienne-page/image-locale-partagee",
              sourceUrl: null,
              file: sharedImage,
              selected: true,
              transform: { ...defaultTransform, fit: "contain" as const },
            },
          ],
        },
      },
      videoByChannel: {
        youtube: {
          file: localVideo,
          previewUrl: "blob:ancienne-page/video",
          name: localVideo.name,
          type: localVideo.type,
          size: localVideo.size,
          duration: 12,
          sourceMetadata: null,
          sourceVideo: null,
          transformedVariants: [],
          format: "original",
          adaptationMode: "safe_frame",
        },
      },
    });

    assert.match(key, /^editor-/);
    assert.equal(sessionStorage.length, 1);
    assert.equal(
      cache.values.size,
      2,
      "le même File image utilisé sur deux canaux ne doit être stocké qu’une fois",
    );

    const restored = await consumeInrSendPublicationEditorSnapshot(key);
    assert.ok(restored);
    assert.equal(restored.itemId, "publication-item-42");
    assert.equal(restored.channel, "instagram");
    assert.equal(restored.form.title, "Titre local non enregistré");
    assert.equal(restored.form.content, "Contenu local modifié");
    assert.deepEqual(
      restored.imagesByChannel.instagram.assets.map((asset) => asset.key),
      ["image-local", "image-distante"],
    );
    assert.equal(restored.imagesByChannel.instagram.assets[0].transform.zoom, 1.35);
    assert.equal(restored.imagesByChannel.instagram.assets[1].selected, false);
    assert.ok(restored.imagesByChannel.instagram.assets[0].file instanceof File);
    assert.equal(
      await restored.imagesByChannel.instagram.assets[0].file?.text(),
      String.fromCharCode(1, 2, 3, 4),
    );
    assert.match(
      restored.imagesByChannel.instagram.assets[0].previewUrl,
      /^blob:/,
    );
    assert.ok(restored.videoByChannel.youtube.file instanceof File);
    assert.equal(restored.videoByChannel.youtube.duration, 12);
    assert.equal(sessionStorage.length, 0, "le snapshot doit être consommé une fois");
    assert.equal(cache.values.size, 0, "les binaires consommés doivent être nettoyés");
    assert.equal(await consumeInrSendPublicationEditorSnapshot(key), null);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("Booster persiste le brouillon avant Generate, Modifier ou Retoucher", () => {
  const source = read("app/dashboard/booster/publier/PublishModal.tsx");
  const helperStart = source.indexOf("const preparePublicationDraftForStudio");
  const generatorStart = source.indexOf("const openInrStudioGenerator");
  const imageToolStart = source.indexOf("const openInrStudioImageTool");
  const videoToolStart = source.indexOf("const openInrStudioVideoRetoucher");
  const renderStart = source.indexOf("return (", videoToolStart);

  assert.ok(helperStart > 0);
  assert.ok(generatorStart > helperStart);
  assert.ok(imageToolStart > generatorStart);
  assert.ok(videoToolStart > imageToolStart);
  const generator = source.slice(generatorStart, imageToolStart);
  const imageTool = source.slice(imageToolStart, videoToolStart);
  const videoTool = source.slice(videoToolStart, renderStart);
  assert.match(generator, /await preparePublicationDraftForStudio\(\)/);
  assert.match(imageTool, /await preparePublicationDraftForStudio\(\)/);
  assert.match(videoTool, /await preparePublicationDraftForStudio\(\)/);
  assert.match(videoTool, /mediaType: "video"/);
  assert.match(videoTool, /videoTransformedVariants/);
  assert.match(source, /return savedDraftId \|\| null/);
  assert.match(source, /returnHref: draftState\.returnHref/);
  assert.match(source, /setPendingStudioReturn\(result\)/);
  assert.match(source, /loadedPublicationDraftId !== expectedDraftId/);
  assert.match(
    source,
    /\/dashboard\?action=publish&draftId=\$\{encodeURIComponent\(savedDraftId\)\}/,
  );
});

test("iNrSend restaure le snapshot sur Fermer comme sur retour Modifier ou Retoucher", () => {
  const source = read("app/dashboard/mails/MailboxClient.tsx");

  assert.match(source, /await saveInrSendPublicationEditorSnapshot\(/);
  assert.match(source, /returnParams\.set\("studio_editor_snapshot", editorSnapshotKey\)/);
  assert.match(source, /returnHref,/);
  assert.match(source, /editorSnapshotKey,/);
  assert.match(source, /consumeInrSendPublicationEditorSnapshot\(snapshotKey\)/);
  assert.match(source, /setPublicationEditForm\(pendingStudioEditorSnapshot\.form\)/);
  assert.match(
    source,
    /setPublicationEditImagesByChannel\([\s\S]*?pendingStudioEditorSnapshot\.imagesByChannel/,
  );
  assert.match(
    source,
    /setPublicationEditVideoByChannel\([\s\S]*?pendingStudioEditorSnapshot\.videoByChannel/,
  );
  assert.match(source, /setDetailsEditMode\(true\)/);
});
