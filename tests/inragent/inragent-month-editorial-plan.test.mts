import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

test("iNrAgent matérialise l'horizon choisi selon les créneaux et critères", () => {
  const planner = read("lib/inrAgentEditorialPlanning.ts");
  const settings = read("lib/inrAgentSettings.ts");
  const config = read("app/dashboard/agent/_lib/agent.config.ts");
  const client = read("app/dashboard/agent/AgentClient.tsx");

  assert.match(planner, /INR_AGENT_EDITORIAL_HORIZON_DAYS = 15/);
  assert.match(settings, /INR_AGENT_PLANNING_HORIZON_DAYS = \[7, 15, 30\]/);
  assert.match(settings, /enabled: false/);
  assert.match(settings, /planningHorizonDays: 15/);
  assert.match(config, /planningHorizonDays: 15/);
  assert.match(client, /<option value=\{7\}>\{i18nT\("7_jours_a0f70b5c"\)\}<\/option>/);
  assert.match(client, /<option value=\{15\}>\{i18nT\("15_jours_recommande_9f4bc5ad"\)\}<\/option>/);
  assert.match(client, /<option value=\{30\}>\{i18nT\("1_mois_e5493c85"\)\}<\/option>/);
  assert.match(planner, /normalizeScheduleSlots\(automation\)/);
  assert.match(planner, /normalizeInrAgentMonthDays/);
  assert.match(planner, /automation\.allowedThemes/);
  assert.match(planner, /automation\.allowedChannels/);
  assert.match(planner, /toneValue\(args\.tone\)/);
  assert.match(planner, /startingIndex \+ sequence/);
  assert.match(planner, /Math\.round\(slotKeys\.length \* 0\.2\)/);
  assert.match(planner, /"realisations", "coulisses", "temoignages"/);
  assert.match(planner, /mediaKind === "image" \? plannedImageCount/);
  assert.match(planner, /channels = channels\.filter\(\(channel\) => channel !== "youtube"\)/);
});

test("les thèmes éditoriaux enrichis traversent réglages, prompts et médias", () => {
  const settings = read("lib/inrAgentSettings.ts");
  const config = read("app/dashboard/agent/_lib/agent.config.ts");
  const prepare = read("app/api/agent/actions/prepare-publish/route.ts");
  const media = read("lib/inrAgentMediaGeneration.ts");

  for (const theme of [
    "coulisses",
    "temoignages",
    "services",
    "faq",
    "recrutement",
  ]) {
    assert.ok(settings.includes(`"${theme}"`), `${theme} doit être autorisé`);
    assert.ok(config.includes(`"${theme}"`), `${theme} doit être envoyé par l'interface`);
    assert.ok(prepare.includes(`${theme}:`), `${theme} doit avoir un thème Booster`);
    assert.ok(prepare.includes(`args.theme === "${theme}"`), `${theme} doit avoir une consigne sûre`);
  }
  assert.match(prepare, /Ne jamais inventer de client, de citation, de note/);
  assert.match(prepare, /Ne jamais annoncer un poste, un contrat, un salaire/);
  assert.match(media, /theme === "coulisses"\) return "behind_scenes"/);
  assert.match(media, /theme === "recrutement"\) return "recruitment"/);
});

test("le plan est durable, dédupliqué et protège les quotas lors d'un changement", () => {
  const server = read("lib/inrAgentEditorialPlanServer.ts");
  const settingsRoute = read("app/api/agent/settings/route.ts");
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const cron = read("app/api/cron/inr-agent-editorial-plan/route.ts");
  const legacyCron = read("app/api/cron/inr-agent/route.ts");
  const vercel = read("vercel.json");

  assert.match(server, /inrAgentEditorialActionId/);
  assert.match(server, /onConflict: "id", ignoreDuplicates: true/);
  assert.match(server, /criteriaChanged/);
  assert.match(server, /analyzeInrAgentEditorialPlanChange/);
  assert.match(server, /pendingEditorialSettings/);
  assert.match(server, /protectedUntil/);
  assert.match(server, /const slotsToGenerate = nextPlan\.filter/);
  assert.match(server, /for \(const slot of slotsToGenerate\)/);
  assert.match(server, /validationWorkflowUpdated/);
  assert.match(server, /editorialValidationModeUpdatedAt/);
  assert.match(server, /!isMutableEditorialRow\(row\)/);
  assert.match(server, /EDITORIAL_GENERATION_LEASE_MS = 20 \* 60 \* 1000/);
  assert.match(server, /"interrupted_generation"/);
  assert.match(server, /recoveredStaleGenerations/);
  assert.match(server, /editorialState: "queued"/);
  assert.match(server, /targetActionId: candidate\.id/);
  assert.match(server, /MAX_EDITORIAL_RETRIES = 4/);
  assert.match(server, /MAX_QUOTA_RETRIES = 12/);
  assert.match(server, /QUOTA_RETRY_DELAY_MS/);
  assert.match(cron, /reconcileInrAgentEditorialPlan/);
  assert.match(cron, /prepareNextInrAgentEditorialSlot/);
  assert.match(settingsRoute, /EDITORIAL_PLAN_CHANGE_CONFIRMATION_REQUIRED/);
  assert.match(settingsRoute, /EDITORIAL_PLAN_QUOTA_INSUFFICIENT/);
  assert.match(settingsRoute, /availableImages/);
  assert.match(settingsRoute, /availableVideos/);
  assert.match(settingsRoute, /editorialSettingsActiveTone/);
  assert.match(settingsRoute, /editorialSettingsActiveTimezone/);
  assert.match(cron, /activeMetadata\.editorialSettingsActiveTone/);
  assert.match(cron, /activeMetadata\.editorialSettingsActiveTimezone/);
  assert.match(cron, /maxGenerations"\) \|\| 3/);
  assert.match(cron, /count: "exact", head: true/);
  assert.match(cron, /\.order\("user_id", \{ ascending: true \}\)/);
  assert.match(cron, /\.range\(pageStart, Math\.max\(pageStart, pageEnd\)\)/);
  assert.match(cron, /rotationOffset/);
  assert.match(cron, /global_enabled: hasEnabledAutomation/);
  assert.match(settingsRoute, /const scheduleTimezone =/);
  assert.match(client, /i18nT\("appliquer_au_prochain_cycle_4bf28644"\)/);
  assert.match(client, /i18nT\("appliquer_maintenant_e43ceda4"\)/);
  assert.match(legacyCron, /reason: "editorial_plan_managed"/);
  assert.match(vercel, /inr-agent-editorial-plan/);
  assert.match(vercel, /"schedule": "\*\/5 \* \* \* \*"/);
});

test("la préparation conserve 1 ou 2 images jusqu'à Booster et à l'agenda", () => {
  const prepare = read("app/api/agent/actions/prepare-publish/route.ts");
  const schedule = read("app/api/agent/actions/schedule/route.ts");
  const preview = read("app/dashboard/agent/_lib/agent.publish-preview.ts");
  const scheduleItems = read("app/dashboard/agent/_lib/agent.schedule-items.ts");
  const client = read("app/dashboard/agent/AgentClient.tsx");

  assert.match(prepare, /requestedGenerationCount/);
  assert.match(prepare, /generatedMediaResults/);
  assert.match(prepare, /mediaAssets/);
  assert.match(prepare, /images,/);
  assert.match(prepare, /loadEarlierEditorialAngles/);
  assert.match(prepare, /TON CHOISI PAR LE PROFESSIONNEL/);
  assert.match(prepare, /editorial_media_required_unavailable/);
  assert.match(prepare, /channel === "youtube_shorts"/);
  assert.match(prepare, /editorialTarget\.plan\.scheduledFor/);
  assert.match(schedule, /buildImagePayloadsFromAgentAction/);
  assert.match(schedule, /images: imagePayloads/);
  assert.match(preview, /uniqueGenericImages/);
  assert.match(scheduleItems, /source: "editorial"/);
  assert.match(client, /buildAgentScheduleItems/);
  assert.match(client, /selectedPreparedActionId/);
  assert.match(client, /selectedPreparedAction\.scheduledFor/);
});

test("les médias iNrAgent sont adaptés sans rognage automatique", () => {
  const normalizer = read("lib/aiMediaNormalizer.ts");
  const schedule = read("app/api/agent/actions/schedule/route.ts");
  const execute = read("app/api/agent/actions/execute/route.ts");
  const client = read("app/dashboard/agent/AgentClient.tsx");

  assert.match(normalizer, /fit: "contain"/);
  assert.match(schedule, /automaticFit: "contain"/);
  assert.match(execute, /automaticFit: "contain"/);
  assert.match(client, /buttonClassName=\{dashboardStyles\.secondaryBtn\}/);
  assert.match(client, /primaryButtonClassName=\{dashboardStyles\.primaryBtn\}/);
});

test("le carrousel de publications conserve les actions éditoriales futures", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");

  assert.match(client, /function isPublicationCarouselAction/);
  assert.match(client, /asRecord\(action\.payload\?\.editorialPlan\)/);
  assert.match(client, /publicationActionSortGroup/);
});

test("le robot du cockpit PC reste entier et proportionnel", () => {
  const styles = read("app/dashboard/agent/agent.module.css");

  assert.match(
    styles,
    /\.automationGridStandard \.agentCommandRailRobot > img[\s\S]*?object-fit: contain !important;/,
  );
  assert.match(styles, /grid-template-rows: 306px repeat\(2, 68px\)/);
  assert.match(
    styles,
    /\.automationGridStandard \.agentCommandRailRobot[\s\S]*?border: 1px solid rgba\(125, 211, 252, 0\.54\)/,
  );
  assert.match(styles, /outline-offset: -7px/);
  assert.match(
    styles,
    /\.automationGrid,[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
});

test("la publication iNrAgent reste manuelle, notifiée et protégée en profondeur", () => {
  const settings = read("lib/inrAgentSettings.ts");
  const config = read("app/dashboard/agent/_lib/agent.config.ts");
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const prepare = read("app/api/agent/actions/prepare-publish/route.ts");
  const schedule = read("app/api/agent/actions/schedule/route.ts");
  const editorial = read("lib/inrAgentEditorialPlanServer.ts");
  const scheduledCron = read("app/api/cron/inr-agent-scheduled-actions/route.ts");
  const migration = read(
    "ops/sql/2026-09-04_inr_agent_safe_editorial_workflow.sql",
  );

  assert.doesNotMatch(settings, /^\s*"automatic_publish",?$/m);
  assert.match(settings, /key === "publish"[\s\S]*?"notify_before_validation"/);
  assert.doesNotMatch(config, /Publication automatique à l’heure prévue/);
  assert.doesNotMatch(client, /automatic_publish_confirm_title/);
  assert.match(prepare, /return "manual_validation"/);
  assert.match(prepare, /return "pending_validation"/);
  assert.match(prepare, /return true;/);
  assert.match(schedule, /resolveInrAgentActionRequest/);
  assert.match(schedule, /INR_AGENT_MANUAL_VALIDATION_REQUIRED/);
  assert.doesNotMatch(editorial, /schedulePreparedAutomaticInrAgentPublications/);
  assert.match(editorial, /cancelAutomaticScheduledExecution/);
  assert.match(editorial, /notifyReadyInrAgentEditorialBatch/);
  assert.match(editorial, /inr_agent_editorial_batch_ready/);
  assert.match(editorial, /editorialReactivatedAt/);
  assert.match(scheduledCron, /automaticPublicationStillAuthorized/);
  assert.match(scheduledCron, /return false;/);
  assert.match(migration, /validation_mode = 'notify_before_validation'/);
  assert.match(migration, /inr_agent_editorial_manual_validation_check/);
  assert.match(migration, /inrcy_save_inr_agent_settings/);
  assert.match(migration, /status = 'cancelled'/);
  assert.match(migration, /validation_required is distinct from true/);
  assert.match(migration, /execution_policy is distinct from 'manual_validation'/);
  assert.match(migration, /else validated_at/);
});

test("les CTA iNrAgent restent structurés et possèdent une destination réelle", () => {
  const ctaPreferences = read("lib/boosterCtaPreferences.ts");
  const ctaDefaults = read("lib/boosterCtaDefaultsServer.ts");
  const prepare = read("app/api/agent/actions/prepare-publish/route.ts");
  const execute = read("app/api/agent/actions/execute/route.ts");
  const preview = read("app/dashboard/agent/_lib/agent.publish-preview.ts");

  assert.match(ctaPreferences, /if \(!websiteUrl\) return emptyCta\(\);/);
  assert.match(ctaPreferences, /if \(phone\) \{/);
  assert.match(ctaPreferences, /ctaMode: "call"/);
  assert.match(ctaPreferences, /ctaPhone: phone/);
  assert.match(ctaPreferences, /if \(!customUrl\) return emptyCta\(\);/);
  assert.match(ctaDefaults, /\.from\("profiles"\)[\s\S]*?\.select\("phone"\)/);
  assert.match(ctaDefaults, /\.from\("inrcy_site_configs"\)[\s\S]*?\.select\("site_url"\)/);
  assert.match(prepare, /applySafePreferredCta\(\{/);
  assert.match(prepare, /preserveExplicit: false/);
  assert.match(prepare, /ctaPolicy: \{/);
  assert.match(execute, /record\.ctaMode \?\? record\.cta_mode/);
  assert.match(execute, /loadBoosterCtaDefaults\(\{ supabase, userId \}\)/);
  assert.match(execute, /applySafePreferredCta\(\{/);
  assert.match(preview, /if \(ctaLabel && ctaPhone\) return `\$\{ctaLabel\} — \$\{ctaPhone\}`/);
});

test("les réglages globaux et les automatisations sont enregistrés atomiquement", () => {
  const route = read("app/api/agent/settings/route.ts");
  const migration = read(
    "ops/sql/2026-09-04_inr_agent_safe_editorial_workflow.sql",
  );

  assert.match(route, /\.rpc\([\s\S]*?"inrcy_save_inr_agent_settings"/);
  assert.match(route, /INR_AGENT_SETTINGS_MIGRATION_REQUIRED/);
  assert.doesNotMatch(
    route,
    /\.from\("inr_agent_settings"\)[\s\S]{0,120}\.upsert\(globalPayload/,
  );
  assert.doesNotMatch(
    route,
    /\.from\("inr_agent_automation_settings"\)[\s\S]{0,120}\.upsert\(automationPayloads/,
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /get diagnostics v_saved_automations = row_count/);
  assert.match(migration, /grant execute[\s\S]*?to service_role/);
});

test("l'activation des réglages reste compacte dans le header", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const styles = read("app/dashboard/agent/agent.module.css");
  const settingsModal = client.slice(
    client.indexOf("{settingsAutomation && settingsConfig && ("),
    client.indexOf("{publishMediaModal ? ("),
  );

  assert.match(settingsModal, /<header className=\{styles\.settingsModalHeader\}>/);
  assert.match(settingsModal, /className=\{styles\.settingsHeaderSwitch\}/);
  assert.match(settingsModal, /disabled=\{settingsNoConnectedChannelBlock\}/);
  assert.match(settingsModal, /className=\{styles\.modalClose\}/);
  assert.doesNotMatch(settingsModal, /className=\{styles\.switchLine\}/);
  assert.match(styles, /\.settingsModalHeaderActions[\s\S]*?display: flex;/);
  assert.match(
    styles,
    /\.settingsModal:not\(\.helpModal\) \.settingsModalHeader \.modalClose[\s\S]*?position: static;/,
  );
});

test("le cockpit mobile garde actions, robot, publication et commandes lisibles", () => {
  const styles = read("app/dashboard/agent/agent.module.css");
  const responsiveStart = styles.lastIndexOf("Composition mobile dédiée");
  const responsiveStyles = styles.slice(responsiveStart);

  assert.ok(responsiveStart >= 0, "la composition mobile finale doit exister");
  assert.match(responsiveStyles, /\.agentCommandRailIdentity\s*\{[\s\S]*?display: none !important;/);
  assert.match(responsiveStyles, /\.automationGrid,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/);
  assert.match(responsiveStyles, /\.robotCard:not\(\.scheduledEditCard\)[\s\S]*?height: 168px !important;/);
  assert.match(responsiveStyles, /\.automationCard \.cardTitleShort\s*\{[\s\S]*?display: block !important;/);
  assert.match(responsiveStyles, /\.automationCard \.settingsButtonLabel\s*\{[\s\S]*?display: none !important;/);
  assert.match(responsiveStyles, /\.publishPostStack\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(responsiveStyles, /\.publishPostStack > \.publishPostCard,[\s\S]*?grid-column: 1 !important;[\s\S]*?grid-row: auto !important;/);
  assert.match(responsiveStyles, /\.publishPostCard,[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(responsiveStyles, /\.publishCtaStandalone\s*\{[\s\S]*?width: 100% !important;/);
  assert.match(responsiveStyles, /\.channelScroller\s*\{[\s\S]*?flex-wrap: nowrap !important;/);
  assert.match(responsiveStyles, /\.saveCampaignDraftButton svg,[\s\S]*?display: block !important;/);
  assert.match(responsiveStyles, /button\[data-channel="linkedin"\] img\.channelLogoLinkedin[\s\S]*?width: 28px !important;[\s\S]*?transform: none !important;/);
  assert.match(responsiveStyles, /button\[data-channel="gmb"\] img[\s\S]*?width: 24px !important;[\s\S]*?transform: scale\(1\.55\) !important;/);
});
