import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyBoosterPublicationResult,
  getPublicationWarningMessage,
  isMediaPublicationWarningCode,
} from "../../lib/boosterPublicationOutcome.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("une publication sans média reste réussie avec un avertissement définitif", () => {
  const outcome = classifyBoosterPublicationResult({
    ok: true,
    warning: "published_without_image",
    warning_message: "Google Business a publié le texte sans image.",
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, "published_with_warning");
  assert.equal(outcome.warningKind, "media_degraded");
  assert.match(outcome.warningMessage || "", /iNrSend/);
  assert.match(outcome.warningMessage || "", /directement sur le canal/);
});

test("un traitement TikTok accepté reste en cours et non dégradé", () => {
  const outcome = classifyBoosterPublicationResult({
    ok: true,
    warning: true,
    tiktok_status: "PROCESSING_UPLOAD",
    warning_message: "TikTok a accepté l'envoi.",
  });

  assert.equal(outcome.status, "processing");
  assert.equal(outcome.warningKind, "pending");
  assert.equal(
    classifyBoosterPublicationResult({
      ok: true,
      tiktok_status: "PROCESSING_UPLOAD",
    }).status,
    "processing",
  );
});

test("succès, échec et avertissement générique sont séparés", () => {
  assert.equal(classifyBoosterPublicationResult({ ok: true }).status, "published");
  assert.equal(classifyBoosterPublicationResult({ ok: false }).status, "failed");
  assert.equal(
    classifyBoosterPublicationResult({
      ok: true,
      warning: "published_without_cta",
      warning_message: "Publié sans bouton.",
    }).status,
    "published_with_warning",
  );
});

test("les codes média connus sont reconnus et reçoivent un message exploitable", () => {
  for (const code of [
    "published_without_image",
    "published_without_video",
    "published_without_media_and_cta",
    "published_with_partial_images",
  ]) {
    assert.equal(isMediaPublicationWarningCode(code), true);
    assert.match(
      getPublicationWarningMessage({ ok: true, warning: code }) || "",
      /iNrSend/,
    );
  }
});

test("les bilans immédiat et asynchrone utilisent le contrat commun", () => {
  const immediate = read("app/api/booster/publish-now/publishNow.foundations.ts");
  const asyncPublication = read("lib/boosterAsyncPublication.ts");
  for (const source of [immediate, asyncPublication]) {
    assert.match(source, /classifyBoosterPublicationResult/);
    assert.match(source, /published_with_warning/);
    assert.match(source, /warningCount/);
    assert.match(source, /mediaWarningCount/);
  }
});

test("Booster et iNrSend affichent explicitement l'avertissement", () => {
  const modal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
  const mailbox = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
  const mailboxHelpers = read("app/dashboard/mails/_lib/mailboxPhase1.tsx");
  assert.match(modal, /Publication publiée avec avertissement/);
  assert.match(modal, /Publié avec avertissement/);
  assert.match(mailbox, /publiee_avec_avertissement_47eb62fb/);
  assert.match(mailboxHelpers, /channelWarningDot/);
  assert.match(mailboxHelpers, /isProcessingChannelResult/);
  assert.match(mailboxHelpers, /channelProcessingDot/);
  assert.match(mailboxHelpers, /En traitement sur ce canal/);
});
