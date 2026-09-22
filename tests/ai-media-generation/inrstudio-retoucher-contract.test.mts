import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

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
  assert.match(modal, /mediaType=\{activeMediaType\}/);
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
