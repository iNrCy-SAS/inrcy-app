import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync("app/dashboard/mails/MailboxClient.tsx", "utf8");
const media = readFileSync("app/dashboard/mails/_hooks/useMailboxPublicationVideo.ts", "utf8");
const foundations = readFileSync(
  "app/dashboard/mails/_lib/mailboxPublicationVideo.foundations.ts",
  "utf8",
);

test("publication video foundations remain pure and are shared by the component and its video controller", () => {
  assert.match(client, /from "\.\/_lib\/mailboxPublicationVideo\.foundations"/);
  assert.match(media, /from "\.\.\/_lib\/mailboxPublicationVideo\.foundations"/);
  assert.match(foundations, /export type PublicationEditVideoState/);
  assert.match(foundations, /export type CampaignDistributionNotice/);
  assert.match(foundations, /export function normalizeBoosterChannelKeyForVideo/);
  assert.match(foundations, /export function attachmentToVideoPayload/);
  assert.match(foundations, /export function readPublicationVideoMetadata/);
  assert.doesNotMatch(foundations, /\buseState\b|\buseEffect\b|\bfetch\s*\(|\bcreateClient\b/);
  assert.doesNotMatch(foundations, /from "\.\.\/MailboxClient"|from "\.\.\/\.\.\/mails\/MailboxClient"/);
  assert.doesNotMatch(client, /type PublicationEditVideoState =/);
  assert.doesNotMatch(client, /function attachmentToVideoPayload/);
  assert.doesNotMatch(client, /function readPublicationVideoMetadata/);
});

test("the publication media controller owns media state while the component keeps campaign state", () => {
  assert.match(client, /useMailboxPublicationMedia\(/);
  assert.match(media, /useState<Record<string, PublicationEditVideoState>>/);
  assert.match(client, /useState<CampaignDistributionNotice \| null>/);
  assert.match(media, /attachmentToVideoPayload\(videoCandidate\)/);
  assert.match(media, /readPublicationVideoMetadata\(file, previewUrl\)/);
  assert.match(media, /normalizeBoosterChannelKeyForVideo\(channel/);
});
