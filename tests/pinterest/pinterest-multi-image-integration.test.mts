import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Booster transmet jusqu'à 5 images à Pinterest", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  assert.match(route, /limit:\s*5/);
  assert.match(route, /imageUrls:\s*pinterestImageUrls/);
  assert.match(route, /userId,\s*boardId/);
  assert.doesNotMatch(route, /Pinterest publie 1 image par épingle/);
});

test("Booster ne bloque plus Pinterest au-delà d'une image", () => {
  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  assert.match(shared, /épingle multi-images/);
  assert.doesNotMatch(shared, /Sélectionnez une seule image/);
});

test("iNrAgent conserve et remplace les 5 images Pinterest", () => {
  const actions = read("lib/inrsend/publicationChannelActions.ts");
  assert.match(actions, /pinterestImageUrls[\s\S]*?slice\(0, 5\)/);
  assert.match(actions, /imageUrls:\s*params\.imageUrls/);
  assert.match(actions, /accessToken,\s*userId,\s*boardId/);
  assert.doesNotMatch(actions, /pinterest_single_image_required/);
});

test("La création d'épingle applique le filet de sécurité de ratio commun", () => {
  const publisher = read("lib/pinterestPublish.ts");
  const preparation = read("lib/pinterestCarouselImages.ts");

  assert.match(publisher, /preparePinterestCarouselImages\(\{/);
  assert.match(publisher, /buildPinterestImageMediaSource\(preparedImages\.imageUrls\)/);
  assert.match(preparation, /BOOSTER_AUTO_CROP_MAX_LOSS/);
  assert.match(preparation, /fit\s*=\s*[\s\S]*?"cover"[\s\S]*?"contain"/);
  assert.match(preparation, /PINTEREST_BACKGROUND/);
  assert.doesNotMatch(preparation, /blur\(|blurBackground:\s*true/);
});

test("Les erreurs Pinterest et TikTok sont normalisées en français", () => {
  const pinterest = read("lib/pinterestPublish.ts");
  const tiktok = read("lib/tiktokPublish.ts");
  const diagnostics = read("lib/channelPublishDiagnostics.ts");
  const resultModal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
  const mailboxPhase = read("app/dashboard/mails/_lib/mailboxPhase1.tsx");
  const mailboxDetails = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");

  assert.match(pinterest, /getProviderPublicationErrorMessage\("pinterest"/);
  assert.match(tiktok, /getProviderPublicationErrorMessage\("tiktok"/);
  assert.match(diagnostics, /ensureFrenchPublicationErrorMessage/);
  assert.match(resultModal, /import \{ getLocalizedErrorMessage \} from "@\/lib\/userFacingErrors"/);
  assert.match(resultModal, /const locale = useLocale\(\)/);
  assert.match(resultModal, /getLocalizedErrorMessage\(\{ message: input, code \}, locale, fallback, \{ allowUnknownMessage: false \}\)/);
  assert.match(resultModal, /visibleWarning/);
  assert.match(resultModal, /visibleBlockers/);
  assert.match(mailboxPhase, /getFrenchPublicationErrorMessage/);
  assert.match(mailboxDetails, /visiblePublicationItemError/);
});
