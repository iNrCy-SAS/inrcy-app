import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toolbar = readFileSync("app/dashboard/mails/_components/MailboxToolbar.tsx", "utf8");
const list = readFileSync("app/dashboard/mails/_components/MailboxList.tsx", "utf8");
const details = readFileSync("app/dashboard/mails/_components/MailboxDetailsModal.tsx", "utf8");
const client = readFileSync("app/dashboard/mails/MailboxClient.tsx", "utf8");
const header = readFileSync("app/dashboard/mails/_components/MailboxHeader.tsx", "utf8");
const deleteRoute = readFileSync("app/api/inrsend/history/delete/route.ts", "utf8");
const historyRoute = readFileSync("app/api/inrsend/history/route.ts", "utf8");
const publishRoute = readFileSync("app/api/booster/publish-now/route.ts", "utf8");
const agentExecute = readFileSync("app/api/agent/actions/execute/route.ts", "utf8");
const scheduledCron = readFileSync("app/api/cron/inr-agent-scheduled-actions/route.ts", "utf8");
const styles = readFileSync("app/dashboard/mails/mails.module.css", "utf8");
const frenchMails = JSON.parse(readFileSync("messages/fr-FR/mails.json", "utf8"));


test("iNrSend ne propose plus de suppression manuelle ni de selection de lignes", () => {
  assert.doesNotMatch(toolbar, /deleteSelectedHistoryEntries|selectedHistoryKeys|Tout sélectionner|Corbeille/i);
  assert.doesNotMatch(list, /type="checkbox"|toggleHistorySelection|selectedHistoryKeys/);
  assert.doesNotMatch(client, /deleteSelectedHistoryEntries|deleteHistoryEntry|selectedHistoryKeys|historySelectionKey/);
  assert.doesNotMatch(styles, /\.rowSelect\b|\.originMarkerSlot\b/);
});


test("la suppression manuelle est refusee cote serveur et le support est indique", () => {
  assert.match(deleteRoute, /inrsend_history_manual_deletion_disabled/);
  assert.match(deleteRoute, /status:\s*403/);
  assert.match(deleteRoute, /contact@inrcy\.com/);
  assert.match(header, /i18nT\("aucune_suppression_manuelle_n_est_disponible_0685aa74"\)/);
  assert.match(
    frenchMails.aucune_suppression_manuelle_n_est_disponible_0685aa74,
    /contact@inrcy\.com/,
  );
});


test("les actions iNrAgent sont identifiables dans la liste et le detail", () => {
  assert.match(list, /originSource === "inr_agent"/);
  assert.doesNotMatch(list, /originMarkerSlot/);
  assert.match(list, /rowActions[\s\S]*inrAgentOriginIcon[\s\S]*detailsBtn/);
  assert.match(list, /\/icons\/inr-agent\.png/);
  assert.match(details, /i18nT\("cree_par_inr_agent_31bbe816"\)/);
  assert.match(details, /inrAgentDetailBadge/);
});


test("le detail navigue entre les lignes sans revenir au tableau", () => {
  assert.match(details, /requestNavigate\(-1\)/);
  assert.match(details, /requestNavigate\(1\)/);
  assert.match(details, /confirmDiscardPublicationEdit/);
  assert.match(details, /detailsBodyRef\.current\?\.scrollTo/);
  assert.match(client, /async function navigateDetails\(direction: -1 \| 1\)/);
  assert.match(client, /loadHistory\(\{ page: targetPage \}\)/);
  assert.match(client, /navigationLabel=\{detailsNavigationLabel\}/);
  assert.match(styles, /detailsNavigationCounter[\s\S]*min-width:\s*96px/);
  assert.match(styles, /detailsNavigationCounter[\s\S]*overflow:\s*visible/);
});


test("la navigation utilise une ligne de lookahead et ne scanne jamais sans borne", () => {
  assert.match(historyRoute, /const targetVisibleCount = end \+ 1/);
  assert.match(historyRoute, /MAX_SOURCE_BATCHES_PER_REQUEST = 40/);
  assert.match(historyRoute, /hasMoreFromPage/);
  assert.match(historyRoute, /totalKnown:\s*false/);
  assert.doesNotMatch(historyRoute, /MAX_ITERATIONS = 5000|fetchAllRows/);
});


test("une publication iNrAgent sans app_event est reconciliee sans doublon", () => {
  assert.match(historyRoute, /mapAgentPublicationFallbacks/);
  assert.match(historyRoute, /mapAgentScheduledPublicationFallbacks/);
  assert.match(historyRoute, /execution\.historyPersisted !== false/);
  assert.match(historyRoute, /publicationHistoryIdentity/);
  assert.match(historyRoute, /dedupeHistoryItems/);
  assert.match(historyRoute, /reconciledFromAgentAction:\s*true/);
  assert.doesNotMatch(historyRoute, /finalizeAsyncPublicationIfReady/);
});


test("publish-now controle et retente uniquement la persistance de l'historique", () => {
  assert.match(publishRoute, /historyEventRow/);
  assert.match(publishRoute, /\.upsert\(historyEventRow, \{ onConflict: "id" \}\)/);
  assert.match(publishRoute, /historyPersisted/);
  assert.match(publishRoute, /iNrSend history persistence failed/);
  assert.match(agentExecute, /historyEventId: publishPayload\?\.historyEventId/);
  assert.match(agentExecute, /historyPersisted: publishPayload\?\.historyPersisted === true/);
  assert.match(scheduledCron, /historyPersisted: result\.historyPersisted === true/);
  assert.match(scheduledCron, /summary: result\.summary \|\| null/);
});
