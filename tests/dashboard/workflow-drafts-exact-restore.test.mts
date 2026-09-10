import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const workflowState = read("app/dashboard/_lib/workflowCampaignState.ts");
const workflowDraftRoute = read("app/api/mails/workflow-draft/route.ts");
const mailbox = read("app/dashboard/mails/MailboxClient.tsx");
const booster = read("app/dashboard/booster/publier/PublishModal.tsx");
const migration = read(
  "supabase/migrations/20260910170000_inrsend_workflow_draft_state.sql",
);

const campaignPages = [
  read("app/dashboard/propulser/page.tsx"),
  read("app/dashboard/fideliser/page.tsx"),
];

const campaignEditors = [
  read("app/dashboard/propulser/components/valoriser/ValoriserModal.tsx"),
  read("app/dashboard/propulser/components/recolter/RecolterModal.tsx"),
  read("app/dashboard/propulser/components/offrir/OffrirModal.tsx"),
  read("app/dashboard/fideliser/components/informer/InformerModal.tsx"),
  read("app/dashboard/fideliser/components/suivre/SuivreModal.tsx"),
  read("app/dashboard/fideliser/components/enqueter/EnqueterModal.tsx"),
];

test("l'état versionné couvre le contenu, les fichiers, le moteur et les cibles", () => {
  for (const token of [
    "version: 1",
    "templateKey",
    "templateCategory",
    "subject",
    "bodyText",
    "bodyHtml",
    "attachments",
    "aiEngine",
    "stage",
    "selectedAccountId",
    "provider",
    "toEmails",
    "recipientHints",
    "trackPayload",
  ]) {
    assert.ok(workflowState.includes(token), `champ manquant: ${token}`);
  }
  assert.match(workflowState, /normalizeWorkflowCampaignAttachments\(value\.attachments\)/);
  assert.match(workflowState, /normalizeWorkflowCampaignRecipientHints\(value\.recipientHints\)/);
});

test("l'API des brouillons est privée au compte actif et protège les éléments envoyés", () => {
  assert.match(workflowDraftRoute, /\.eq\("user_id", activeUserId\)/);
  assert.match(
    workflowDraftRoute,
    /\.update\(payload\)[\s\S]{0,220}\.eq\("type", "mail"\)[\s\S]{0,100}\.eq\("status", "draft"\)/,
  );
  assert.match(workflowDraftRoute, /target\.folder !== folder/);
  assert.match(workflowDraftRoute, /draft_state: draftState/);
  assert.match(workflowDraftRoute, /"Cache-Control": "private, no-store"/);
});

test("chaque éditeur de campagne sauvegarde et restaure le même instantané", () => {
  for (const editor of campaignEditors) {
    assert.match(editor, /readWorkflowCampaignState\(restoreKey\)/);
    assert.match(editor, /setSubject\(restored\.subject \|\| ""\)/);
    assert.match(editor, /setBody\(restored\.bodyText \|\| ""\)/);
    assert.match(editor, /setBodyHtml\(restored\.bodyHtml/);
    assert.match(editor, /setAttachments\(restored\.attachments \|\| \[\]\)/);
    assert.match(editor, /if \(restored\.aiEngine\) setAiEngine\(restored\.aiEngine\)/);
    assert.match(editor, /saveWorkflowCampaignDraft\(state\)/);
    assert.match(editor, /selectedAccountId: restored\?\.selectedAccountId \|\| null/);
    assert.match(editor, /recipientHints: restored\?\.recipientHints \|\| \[\]/);
    assert.match(editor, /trackPayload: restored\?\.trackPayload \|\| \{\}/);
  }
});

test("les campagnes ouvrent leurs brouillons depuis le header et reprennent la bonne étape", () => {
  for (const page of campaignPages) {
    assert.match(page, /<PublishDraftHeaderMenu/);
    assert.match(page, /loadWorkflowCampaignDraft\(draftId\)/);
    assert.match(page, /draft\.stage === "compose"/);
    assert.match(page, /workflow_return_key: restoreKey/);
    assert.match(page, /restore_key=\$\{encodeURIComponent\(restoreKey\)\}/);
  }
});

test("iNrSend restaure le compte, les destinataires, le ciblage et les pièces jointes", () => {
  assert.match(mailbox, /draft_state: draftState/);
  assert.match(mailbox, /setSelectedAccountId\(nextSelectedAccountId\)/);
  assert.match(mailbox, /setTo\(raw\.to_emails \|\| ""\)/);
  assert.match(mailbox, /normalizeComposeRecipientHints\(draftState\.recipientHints\)/);
  assert.match(mailbox, /setComposeAttachments\(nextAttachments\)/);
  assert.match(mailbox, /storedComposeState\?\.trackPayload/);
  assert.match(mailbox, /A restored compose draft is already the user's exact snapshot/);
});

test("Booster reprend tous les réglages de publication et les médias", () => {
  for (const token of [
    "channels: selectedChannels",
    "postByChannel: preparedPostsByChannel",
    "imageDrafts",
    "videoDraft",
    "channelMediaModes",
    "videoSettingsByChannel",
    "imageSettingsByChannel",
    "aiPreferredEngine",
    "instagramHashtagsInput",
    "xHashtagsInput",
    "instagramPublicationPlacement",
    "facebookPublicationPlacement",
    "pinterestBoardId",
    "tiktokPublicationSettings",
  ]) {
    assert.ok(booster.includes(token), `état Booster manquant: ${token}`);
  }
  assert.match(booster, /restorePublicationDraftImages\(imageDrafts\)/);
  assert.match(booster, /restorePublicationDraftVideo\(videoDraft\)/);
  assert.match(booster, /setSelectedAiPreferredEngine\(nextAiPreferredEngine\)/);
  assert.match(booster, /setTiktokPublicationSettings\(nextTiktokPublicationSettings\)/);
});

test("la migration de l'état riche est additive, typée JSON et réexécutable", () => {
  assert.match(migration, /add column if not exists draft_state jsonb/);
  assert.match(migration, /jsonb_typeof\(draft_state\) = 'object'/);
  assert.doesNotMatch(migration, /\b(drop|truncate|delete)\b/i);
});
