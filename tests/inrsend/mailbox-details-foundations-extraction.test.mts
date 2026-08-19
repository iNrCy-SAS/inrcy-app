import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const modal = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
const foundations = read("app/dashboard/mails/_lib/mailboxDetails.foundations.ts");
const phase1 = read("app/dashboard/mails/_lib/mailboxPhase1.tsx");

test("MailboxDetailsModal delegates pure contracts to its foundations module", () => {
  assert.match(modal, /from "\.\.\/_lib\/mailboxDetails\.foundations"/);
  assert.doesNotMatch(modal, /function getTiktokStatusMeta\(/);
  assert.doesNotMatch(modal, /type MailboxDetailsModalProps =/);
  assert.match(foundations, /export function getTiktokStatusMeta\(/);
  assert.match(foundations, /export type MailboxDetailsModalProps =/);
});

test("mailbox details foundations stay free of component and network side effects", () => {
  assert.match(foundations, /export function isCampaignFinishedStatus\(/);
  assert.match(foundations, /export function getYoutubeShortsPublicationUrl\(/);
  assert.doesNotMatch(foundations, /\bfetch\s*\(/);
  assert.doesNotMatch(foundations, /createClient\s*\(/);
  assert.doesNotMatch(foundations, /\bsupabase\b/i);
  assert.doesNotMatch(foundations, /\buse(?:State|Effect|Memo|Callback|Ref)\b/);
});

test("TikTok pending status is shown as processing instead of published with warning", () => {
  assert.match(foundations, /PROCESSING_TIMEOUT/);
  assert.match(foundations, /tiktok_status_check_count/);
  assert.match(foundations, /tiktok_processing_duration_seconds/);
  assert.match(modal, /i18nT\("dernier_controle_value_4a972550"/);
  assert.match(modal, /i18nT\("code_tiktok_8230f144"\)/);
  assert.match(phase1, /normalizedChannel === "tiktok"/);
  assert.match(phase1, /!tiktokTerminal/);
  assert.match(modal, /isWarningChannelResult\([\s\S]*activePublicationEntry\?\.key/);
});
