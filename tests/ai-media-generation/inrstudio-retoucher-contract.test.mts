import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildInrStudioReturnHref,
  clearInrStudioHandoff,
  consumeInrStudioReturn,
  createInrStudioHandoff,
  loadInrStudioHandoffSourceFile,
  readInrStudioHandoff,
  saveInrStudioReturn,
} from "../../lib/inrStudioNavigation.ts";

function read(relativePath: string) {
  return readFileSync(path.resolve(relativePath), "utf8");
}

const retoucher = read("app/dashboard/_components/MediaRetoucher.tsx");
const studio = read(
  "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx"
);
const modifier = read("app/dashboard/_components/MediaModifier.tsx");
const videoRetoucher = read(
  "app/dashboard/_components/MediaVideoRetoucher.tsx"
);
const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
const generator = read("app/dashboard/_components/MediaGenerator.tsx");
const modalStyles = read(
  "app/dashboard/_components/MediaGeneratorModal.module.css"
);
const retoucherStyles = read(
  "app/dashboard/_components/MediaRetoucher.module.css"
);
const videoRetoucherStyles = read(
  "app/dashboard/_components/MediaVideoRetoucher.module.css"
);
const navigation = read("lib/inrStudioNavigation.ts");

class MemorySessionStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
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

test("Retoucher accepte le catalogue image commun et normalise les formats non décodables", () => {
  assert.match(retoucher, /INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES/);
  assert.match(retoucher, /INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS/);
  assert.match(retoucher, /prepareMediaGenerationImageReference\(file\)/);
  assert.match(retoucher, /renderFile = new File\(\[normalizedBlob\]/);
  assert.doesNotMatch(retoucher, /JPG, PNG ou WebP/);
});

test("Retoucher conserve l'original mais rend et enregistre depuis la copie décodable", () => {
  assert.match(retoucher, /sourceFile: source\.file/);
  assert.match(retoucher, /renderSourceFile: source\.renderFile/);
  assert.match(studio, /sourceFile: value\.renderSourceFile/);
  assert.match(studio, /source_name: value\.sourceFile\.name/);
});

test("le retour iNrStudio conserve le contexte du point d'entrée", () => {
  assert.match(studio, /action: "retouch"/);
  assert.match(studio, /context: handoff\.context/);
  assert.match(studio, /buildInrStudioReturnHref\(handoff\)/);
});

test("le handoff local conserve le binaire, l'URL de retour exacte et se consomme une seule fois", async () => {
  const sessionStorage = new MemorySessionStorage();
  const cache = new MemoryCache();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage,
      caches: { open: async () => cache },
      location: {
        origin: "https://app.inrcy.test",
        pathname: "/dashboard/booster",
        search: "?draft=42",
        hash: "#editor",
      },
    },
  });

  try {
    const source = new File([new Uint8Array([1, 2, 3, 4])], "flyer.png", {
      type: "image/png",
      lastModified: 123,
    });
    const { handoff, href } = await createInrStudioHandoff({
      tab: "retouch",
      origin: "booster",
      returnHref: "/dashboard/booster?draft=42#editor",
      source: { mediaType: "image", file: source },
      context: { draftId: "42", channel: "instagram" },
    });

    assert.match(href, /studio_tab=retouch/);
    assert.equal(readInrStudioHandoff(handoff.key)?.context.draftId, "42");
    const restoredSource = await loadInrStudioHandoffSourceFile(handoff);
    assert.ok(restoredSource instanceof File);
    assert.equal(restoredSource.name, "flyer.png");
    assert.deepEqual(
      Array.from(new Uint8Array(await restoredSource.arrayBuffer())),
      [1, 2, 3, 4],
    );

    saveInrStudioReturn({
      version: 1,
      returnKey: handoff.returnKey,
      handoffKey: handoff.key,
      action: "retouch",
      createdAt: Date.now(),
      context: handoff.context,
      item: { id: "media-42", media_type: "image" },
    });
    const returnHref = buildInrStudioReturnHref(handoff);
    assert.equal(
      returnHref,
      `/dashboard/booster?draft=42&studio_return=${handoff.returnKey}#editor`,
    );
    assert.equal(consumeInrStudioReturn(handoff.returnKey)?.item.id, "media-42");
    assert.equal(consumeInrStudioReturn(handoff.returnKey), null);

    await clearInrStudioHandoff(handoff.key);
    assert.equal(readInrStudioHandoff(handoff.key), null);
    assert.equal(cache.values.size, 0);
    assert.equal(sessionStorage.length, 0);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("Retoucher garde son chargement initial vivant sous React StrictMode", () => {
  assert.match(retoucher, /const mountedRef = useRef\(false\)/);
  assert.match(retoucher, /mountedRef\.current = true/);
  assert.match(
    retoucher,
    /unmountCleanupTimerRef\.current = window\.setTimeout\([\s\S]*?if \(mountedRef\.current\) return;[\s\S]*?sourceRequestRef\.current \+= 1/
  );
  assert.doesNotMatch(
    retoucher,
    /useEffect\(\(\) => \{\s*return \(\) => \{\s*sourceRequestRef\.current \+= 1;/
  );
});

test("Modifier et Retoucher bornent le décodage navigateur avant normalisation", () => {
  for (const source of [retoucher, modifier]) {
    assert.match(source, /IMAGE_PREVIEW_LOAD_TIMEOUT_MS = 8_000/);
    assert.match(source, /image_preview_timeout/);
    assert.match(source, /window\.clearTimeout\(timeoutId\)/);
  }
  assert.match(
    retoucher,
    /catch \{[\s\S]*?prepareMediaGenerationImageReference\(file\)/
  );
  assert.match(
    modifier,
    /catch \{[\s\S]*?prepareMediaGenerationImageReference\(file\)/
  );
});

test("le handoff affiche l'aperçu compatible avant la relecture complète du fichier", () => {
  assert.match(studio, /getImmediateSourcePreview\(nextHandoff\)/);
  assert.match(studio, /setReady\(true\)/);
  assert.match(studio, /sourceLoadRef\.current\?\.handoffKey/);
  assert.match(studio, /initialPreview=\{initialPreview\}/);
  assert.match(studio, /initialSourceLoading=\{initialSourceLoading\}/);
  assert.match(retoucher, /initialPreview\?\.url/);
  assert.match(modifier, /initialPreview\?\.url/);
  assert.match(navigation, /sourceFile \? URL\.createObjectURL\(sourceFile\)/);
  assert.match(navigation, /fetch\(source\.url, \{ cache: "force-cache" \}\)/);
});

test("Modifier attend la fin du handoff avant de consommer la source initiale", () => {
  assert.match(
    modifier,
    /!initialSource\s*\|\|\s*initialSourceLoading\s*\|\|\s*initializedSourceRef\.current === initialSource/,
  );
  assert.match(
    modifier,
    /\[initialSource, initialSourceLoading, selectSourceFile\]/,
  );
});

test("Retoucher distingue un travail non enregistré d'une opération réellement bloquante", () => {
  assert.match(retoucher, /onEditingChange\?\.\(sourcePreparing \|\| saving\)/);
  assert.match(retoucher, /onDirtyChange\?\.\(Boolean\(source\) && !saved\)/);
  assert.doesNotMatch(retoucher, /onEditingChange\?\.\(Boolean\(source\)\)/);
  assert.match(
    videoRetoucher,
    /onEditingChange\?\.\(saving \|\| Boolean\(initialSourceLoading && !source\)\)/,
  );
  assert.match(videoRetoucher, /onDirtyChange\?\.\(Boolean\(source\) && !saved\)/);
  assert.match(videoRetoucher, /finally \{\s*setSaving\(false\);\s*\}/);
  assert.match(modal, /const \[retoucherDirty, setRetoucherDirty\] = useState\(false\)/);
  assert.match(modal, /const hasPendingWork = hasResult \|\| retoucherDirty/);
  assert.equal((modal.match(/onDirtyChange=\{setRetoucherDirty\}/g) || []).length, 2);
});

test("les références locales gardent leur FileList, se retirent directement et restent verrouillées pendant le lot", () => {
  assert.match(
    generator,
    /const files = Array\.from\(\s*event\.currentTarget\.files \|\| \[\]\s*\);\s*event\.currentTarget\.value = "";/,
  );
  assert.match(
    generator,
    /className=\{styles\.referenceTileRemove\}[\s\S]*?onClick=\{\(\) => removeReferenceAt\(index\)\}/,
  );
  assert.match(
    generator,
    /const handleReferenceFiles[\s\S]*?setInspirationBusy\(true\)[\s\S]*?manageBusy: false, clearError: false[\s\S]*?finally \{\s*setInspirationBusy\(false\);/,
  );
  assert.match(generator, /inspirationImages: mediaSourceMode === "real" \? inspirationImages : \[\]/);
});

test("Retoucher vidéo réutilise le moteur d'adaptation existant dans iNrStudio", () => {
  assert.match(videoRetoucher, /UNIVERSAL_MEDIA_VIDEO_MIME_TYPES/);
  assert.match(videoRetoucher, /UNIVERSAL_MEDIA_VIDEO_EXTENSIONS/);
  assert.match(videoRetoucher, /BoosterVideoFormatManager/);
  assert.match(videoRetoucher, /accept="video"/);
  assert.match(videoRetoucher, /Utiliser ce média/);
  assert.match(videoRetoucher, /Enregistrer dans la Médiathèque/);
  assert.match(videoRetoucher, /Ajoutez une vidéo pour commencer/);
  assert.match(videoRetoucher, /disabled=\{!source \|\| saving\}/);
  assert.match(
    videoRetoucherStyles,
    /\.root\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto;/
  );
  assert.match(
    videoRetoucherStyles,
    /\.editorWorkspace\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/
  );
  assert.match(studio, /requestBoosterVideoTransforms\(\{/);
  assert.match(studio, /sourceMetadata: value\.source\.sourceMetadata/);
  assert.match(studio, /media_type: "video"/);
  assert.match(studio, /transformed_variants: transformedVariants/);
  assert.match(studio, /onVideoRetouched=\{saveRetouchedVideo\}/);
});

test("Retoucher garde les informations sous l'image et rend toute la zone vidéo cliquable", () => {
  assert.match(
    retoucherStyles,
    /\.sourcePreview\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/
  );
  assert.match(
    retoucherStyles,
    /\.sourceMeta\s*\{[^}]*position:\s*static;/
  );
  assert.doesNotMatch(
    retoucherStyles,
    /\.sourceMeta\s*\{[^}]*position:\s*absolute;/
  );
  assert.match(
    videoRetoucher,
    /<button\s+[\s\S]*?className=\{styles\.dropzone\}[\s\S]*?onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\}/
  );
  assert.match(
    videoRetoucher,
    /className=\{styles\.dropIcon\}>＋<\/span>/
  );
});

test("le header iNrStudio centralise Action et Image ou Vidéo", () => {
  assert.match(modal, /className=\{styles\.studioTabs\}/);
  assert.match(modal, /className=\{styles\.mediaTypeTabs\}/);
  assert.match(modal, /\["image", "video"\] as const/);
  assert.match(
    studio,
    /initialMediaType=\{handoff\?\.source\?\.mediaType \|\| "image"\}/
  );
  assert.match(modal, /activeMediaType === "video"/);
  assert.match(modal, /mediaType=\{mediaTypeByTab\.generate\}/);
  assert.match(modal, /<MediaFreeGenerator[\s\S]*?mediaType=\{kind\}/);
  assert.match(modal, /className=\{styles\.creationModeTabs\}/);
  assert.doesNotMatch(modal, /retouchMediaSwitch/);
  assert.match(
    modalStyles,
    /\.heading\s*\{[\s\S]*?grid-template-columns:[\s\S]*?\.mediaTypeTabs\s*\{/
  );
});

test("Retoucher possède une identité corail distincte, sans l'ancien vert principal", () => {
  assert.match(
    modalStyles,
    /\.dialog\[data-studio-tab="retouch"\]\s*\{[\s\S]*?--studio-primary:\s*255, 174, 73;/
  );
  assert.match(retoucherStyles, /--retoucher-accent:\s*255, 174, 73;/);
  assert.doesNotMatch(retoucherStyles, /--retoucher-accent:\s*42, 219, 174;/);
});

test("le handoff transporte images et vidéos sans télécharger les vidéos distantes", () => {
  assert.match(
    navigation,
    /export type InrStudioMediaType = "image" \| "video"/
  );
  assert.match(navigation, /mediaType:\s*InrStudioMediaType/);
  assert.match(navigation, /if \(source\.mediaType === "video"\) return null/);
  assert.match(
    studio,
    /initialMediaType=\{handoff\?\.source\?\.mediaType \|\| "image"\}/
  );
});
