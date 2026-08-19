import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
} from "../../lib/mediaLibraryOptimizationPolicy.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("the 300 Mo source safety ceiling remains unchanged and is explained before optimization", () => {
  assert.equal(MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES, 300 * 1024 * 1024);
  assert.equal(MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES, 300 * 1024 * 1024);

  const optimizer = read("app/dashboard/_components/MediaOptimizerModal.tsx");
  const warning = read(
    "app/dashboard/booster/publier/components/PublishWarningModals.tsx",
  );

  assert.match(optimizer, /const sourceTooLarge = Boolean/);
  assert.match(optimizer, /i18nT\("fichier_source_trop_volumineux_c85fdcd0"\)/);
  assert.match(optimizer, /i18nT\("maximum_et_ne_peut_donc_pas_554ed6aa"\)/);
  assert.match(optimizer, /!requirements\?\.needsOptimization \|\| sourceTooLarge/);
  assert.match(warning, /sourceMaxBytes/);
  assert.match(warning, /i18nT\("inrcy_accepte_un_fichier_source_de_09666c76"/);
  assert.match(warning, /!sourceTooLarge \? \(/);
});

test("mail compose always calls its optimizer hooks before the closed-modal return", () => {
  const compose = read(
    "app/dashboard/mails/_components/MailboxComposeModal.tsx",
  );
  const earlyReturn = compose.indexOf("if (!open) return null;");
  assert.ok(earlyReturn > 0);
  for (const declaration of [
    "const appendComposeAttachments = React.useCallback",
    "const openOptimizerForFiles = React.useCallback",
    "const closeOptimizer = React.useCallback",
  ]) {
    const hook = compose.indexOf(declaration);
    assert.ok(hook > 0, `${declaration} is present`);
    assert.ok(hook < earlyReturn, `${declaration} runs before the early return`);
  }
});

test("Booster inserts valid images and queues every oversized image", () => {
  const controller = read(
    "app/dashboard/booster/publier/usePublishImageController.ts",
  );
  const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(controller, /const oversizedFiles = allowed\.filter/);
  assert.match(controller, /const insertableFiles = allowed\.filter/);
  assert.match(
    controller,
    /onOversizedMedia\?\.\(first, targetChannel, rest\)/,
  );
  assert.match(controller, /queueOversizedFiles\(\);\s+return true;/);
  assert.match(publishModal, /const \[mediaOptimizerQueue, setMediaOptimizerQueue\]/);
  assert.match(publishModal, /\[file, \.\.\.queuedFiles\]/);
  assert.match(
    publishModal,
    /mediaOptimizerCompleted && mediaOptimizerQueue\.length > 0/,
  );
  assert.match(publishModal, /setMediaOptimizerCompleted\(true\)/);
});

test("iNrAgent offers the same optimizer for publications and campaign attachments", () => {
  const agent = read("app/dashboard/agent/AgentClient.tsx");
  const actionModals = read(
    "app/dashboard/agent/_components/AgentActionModals.tsx",
  );

  assert.match(agent, /<MediaOptimizerModal/);
  assert.match(agent, /destination: "publish" \| "campaign"/);
  assert.match(agent, /openMediaOptimizerForFiles\(\[file\], "publish"\)/);
  assert.match(agent, /openMediaOptimizerForFiles\(oversizedMedia, "campaign"\)/);
  assert.match(agent, /maxImageBytes=\{AGENT_MEDIA_MAX_IMAGE_BYTES\}/);
  assert.match(agent, /maxVideoBytes=\{AGENT_MEDIA_MAX_VIDEO_BYTES\}/);
  assert.match(agent, /maxAttachmentBytes=\{MEDIA_LIBRARY_EMAIL_TARGET_BYTES\}/);
  assert.match(actionModals, /maxImageBytes=\{maxAttachmentBytes\}/);
  assert.match(actionModals, /maxVideoBytes=\{maxAttachmentBytes\}/);
});

test("iNrSend publication editing routes oversized direct and library media through the optimizer", () => {
  const details = read(
    "app/dashboard/mails/_components/MailboxDetailsModal.tsx",
  );
  const foundations = read(
    "app/dashboard/mails/_lib/mailboxDetails.foundations.ts",
  );

  assert.match(details, /<MediaOptimizerModal/);
  assert.match(details, /handlePublicationImageFiles/);
  assert.match(details, /handlePublicationVideoFiles/);
  assert.match(details, /handlePublicationPhoto/);
  assert.match(details, /maxImageBytes=\{BOOSTER_MAX_IMAGE_BYTES\}/);
  assert.match(details, /maxVideoBytes=\{BOOSTER_MAX_VIDEO_BYTES\}/);
  assert.match(details, /onOversizedMedia=\{openPublicationOptimizerForLibraryItem\}/);
  assert.match(
    foundations,
    /addPublicationFiles: \(fileList: FileList \| File\[\] \| null\)/,
  );
  assert.match(
    foundations,
    /addPublicationVideo: \(fileList: FileList \| File\[\] \| null\)/,
  );
});
