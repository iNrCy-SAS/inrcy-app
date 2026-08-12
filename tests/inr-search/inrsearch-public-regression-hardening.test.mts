import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("website embeds renew private booster and universal media URLs from durable storage references", () => {
  const render = read("app/embed/actus/_lib/render.ts");
  const mediaRoute = read("app/embed/actus/media/route.ts");
  const helper = read("lib/embedActusMedia.ts");

  assert.match(render, /article\.video_path/);
  assert.match(render, /metadataVideo\.storagePath/);
  assert.match(render, /metadataVideo\.bucket/);
  assert.match(render, /buildStableEmbedActusMediaUrl/);
  assert.match(helper, /"booster", "inrcy-pro-media"/);
  assert.match(helper, /createHmac\("sha256"/);
  assert.match(mediaRoute, /verifyEmbedActusMediaToken/);
  assert.match(mediaRoute, /parsedLegacyReference\?\.bucket === "booster"/);
  assert.match(mediaRoute, /createSafeStorageSignedUrl/);
  assert.doesNotMatch(render, /Vidï¿½o|actualitï¿½|prï¿½cï¿½dente/);
  assert.match(render, /Vidéo indisponible/);
});

test("the iNrSearch settings drawer overrides the dashboard touch nowrap rule locally", () => {
  const source = read("app/dashboard/settings/_components/InrSearchSettingsContent.tsx");
  const css = read("app/dashboard/settings/_components/InrSearchSettingsContent.module.css");

  assert.match(source, /InrSearchSettingsContent\.module\.css/);
  assert.match(source, /localStyles\.muted/);
  assert.match(source, /localStyles\.directoryButton/);
  assert.match(css, /white-space:\s*normal !important/);
  assert.match(css, /margin-left:\s*0 !important/);
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test("public iNrSearch logos can fall back from the account profile to the owner profile", () => {
  const publicData = read("lib/inrSearchPublic.ts");
  const logoHelpers = read("lib/profileLogo.ts");

  assert.match(publicData, /const accountProfile/);
  assert.match(publicData, /const ownerProfile/);
  assert.match(publicData, /const logoCandidates/);
  assert.match(publicData, /probeStorageObject/);
  assert.match(publicData, /objectState === "missing"/);
  assert.match(logoHelpers, /extractLogoPathFromUrl\(source\?\.logo_path/);
});

test("mobile iNrSearch always paints an opaque dark surface between horizontal scenes", () => {
  const page = read("app/entreprises/[slug]/page.tsx");
  const css = read("app/entreprises/[slug]/inrSearchPublic.module.css");
  const experience = read("app/entreprises/[slug]/InrSearchExperience.tsx");
  const marker = "/* iNrSearch — Étape 4 : surface mobile opaque et compositing sans flash blanc. */";
  const block = css.slice(css.indexOf(marker));

  assert.ok(block.startsWith(marker));
  assert.match(page, /html,body\{background:#050b2b!important/);
  assert.match(block, /\.orbitViewport\s*\{[\s\S]*#050b2b !important/);
  assert.match(block, /flex:\s*0 0 100% !important/);
  assert.match(block, /width:\s*100% !important/);
  assert.match(block, /-webkit-overflow-scrolling:\s*auto !important/);
  assert.match(experience, /item\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(experience, /item\.setAttribute\("inert", ""\)/);
  assert.doesNotMatch(
    experience,
    /item\.setAttribute\("inert", ""\)[\s\S]{0,80}item\.removeAttribute\("inert"\)/,
  );
});

test("iNrSearch news renews publication media from durable storage before historical URLs", () => {
  const publicData = read("lib/inrSearchPublic.ts");

  assert.match(publicData, /collectImageStorageCandidates/);
  assert.match(publicData, /post\.storagePaths/);
  assert.match(publicData, /post\.publishableStoragePaths/);
  assert.match(publicData, /post\.socialFeedStoragePaths/);
  assert.match(publicData, /collectVideoStorageCandidates/);
  assert.match(publicData, /collectThumbnailStorageCandidates/);
  assert.match(publicData, /createSafeStorageSignedUrl\([\s\S]*MEDIA_SIGNED_URL_TTL_SECONDS/);
  assert.match(publicData, /const storageUrl = await resolveStorageMediaUrl/);
  assert.match(publicData, /normalizeBoosterPublicationEvents\(boosterEventsRes\.data\)/);
  assert.match(publicData, /normalizeDurableInrSearchPublications/);
  assert.match(publicData, /"inr-search-public-page-v3"/);
});

test("public iNrSearch news keeps all media contained and exposes video controls", () => {
  const showcase = read("app/entreprises/[slug]/InrSearchNewsShowcase.tsx");
  const css = read("app/entreprises/[slug]/inrSearchPublic.module.css");
  const marker = "/* === iNrSearch media framing hardening ===";
  const block = css.slice(css.indexOf(marker));

  assert.ok(block.startsWith(marker));
  assert.match(showcase, /className=\{styles\.newsOrbitFocusVideo\}[\s\S]{0,400}controls/);
  assert.match(showcase, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(showcase, /!activePublication\.videoUrl \? <span className=\{styles\.newsOrbitFocusShade\}/);
  assert.match(block, /newsOrbitFocusMedia > img,[\s\S]*newsOrbitModalMedia video[\s\S]*object-fit:\s*contain !important/);
  assert.match(block, /object-position:\s*center center !important/);
  assert.match(block, /newsOrbitFocus:hover[\s\S]*transform:\s*none !important/);
});

test("public iNrSearch news uses one full stage and ten direct number controls", () => {
  const showcase = read("app/entreprises/[slug]/InrSearchNewsShowcase.tsx");
  const css = read("app/entreprises/[slug]/inrSearchPublic.module.css");
  const marker = "/* === iNrSearch news single-stage and direct-number navigation ===";
  const block = css.slice(css.indexOf(marker));

  assert.ok(block.startsWith(marker));
  assert.doesNotMatch(showcase, /styles\.newsOrbitSecondary/);
  assert.doesNotMatch(showcase, /<strong>\{publication\.title\}<\/strong>/);
  assert.doesNotMatch(showcase, /formatShortDate/);
  assert.match(showcase, /aria-current=\{index === activeIndex/);
  assert.match(block, /newsOrbitStage[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) !important/);
  assert.match(block, /newsOrbitRailItem\[data-active="true"\]/);
  assert.match(block, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(block, /newsOrbitModalMedia > img,[\s\S]*position:\s*absolute !important/);
  assert.match(block, /newsOrbitModalMedia > video[\s\S]*height:\s*100% !important/);
});

test("successful iNrSearch deliveries have a durable text and media recovery path", () => {
  const publishRoute = read("app/api/booster/publish-now/route.ts");
  const publicData = read("lib/inrSearchPublic.ts");

  assert.match(publishRoute, /const inrSearchSnapshot = inrSearchSelected/);
  assert.match(
    publishRoute,
    /publicationInsert\.media_metadata\s*=\s*\{\s*inrSearch:\s*inrSearchSnapshot\s*\}/,
  );
  assert.match(publishRoute, /publishableStoragePaths/);
  assert.match(publicData, /from\("publication_deliveries"\)/);
  assert.match(publicData, /normalizeDurableInrSearchPublications/);
  assert.match(publicData, /mergeInrSearchPublicationFeeds/);
});
