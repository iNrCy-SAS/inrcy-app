import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("iNrAgent regenerates content for the selected channel or atomically for every channel", () => {
  const route = read("app/api/agent/actions/regenerate-channel/route.ts");
  const contentBranch = route.slice(
    route.indexOf('if (kind === "content")'),
    route.indexOf("const mediaModeByChannel"),
  );

  assert.match(
    route,
    /Régénère uniquement le contenu éditorial de ce canal : titre, texte, CTA et hashtags.*Ne modifie ni la date, ni le média, ni les autres canaux/,
  );
  assert.match(route, /Le titre, le texte, le CTA et les hashtags doivent former un ensemble cohérent/);
  assert.match(route, /body\?\.scope === "publication" \? "publication" : "channel"/);
  assert.match(
    contentBranch,
    /requestedScope === "publication" \? actionChannels : \[channel\]/,
  );
  assert.match(contentBranch, /channels: contentTargetChannels as BoosterChannels\[\]/);
  assert.match(contentBranch, /for \(const targetChannel of contentTargetChannels\)/);
  assert.match(contentBranch, /Le moteur n’a pas produit toutes les versions demandées/);
  assert.match(contentBranch, /const targetCurrentPost = readPublishPost/);
  assert.match(contentBranch, /\.\.\.targetCurrentPost,/);
  assert.match(contentBranch, /title: regeneratedPost\.title/);
  assert.match(contentBranch, /subject: regeneratedPost\.subject/);
  assert.match(contentBranch, /content: regeneratedPost\.content/);
  assert.match(contentBranch, /text: regeneratedPost\.text/);
  assert.match(contentBranch, /body: regeneratedPost\.body/);
  assert.match(contentBranch, /cta: preserveCurrentCta[\s\S]*?targetCurrentPost\.cta[\s\S]*?regeneratedPost\.cta/);
  assert.match(contentBranch, /callToAction: preserveCurrentCta[\s\S]*?targetCurrentPost\.callToAction[\s\S]*?regeneratedPost\.callToAction/);
  assert.match(contentBranch, /hashtags: regeneratedPost\.hashtags/);
  assert.match(contentBranch, /applySafePreferredCta\(/);
  assert.match(contentBranch, /preserveExplicit: true/);
  assert.match(contentBranch, /nextPostByChannel\[targetChannel\] = applySafePreferredCta/);
  assert.match(
    contentBranch,
    /previewText: buildPublishPreviewTextFromPosts\(nextPostByChannel, action\.previewText\)/,
  );
  assert.match(contentBranch, /\? "regenerate_publish_global_content"[\s\S]*?: "regenerate_publish_channel_content"/);
  assert.match(contentBranch, /editType:[\s\S]*?"regenerate_publish_global_content"/);
  assert.match(contentBranch, /appliedToChannels: contentTargetChannels/);
  assert.doesNotMatch(contentBranch, /generateInrAgentMedia/);
  assert.doesNotMatch(contentBranch, /setChannelValue/);
});

test("media regeneration is atomic, generated once and applied to every publication channel", () => {
  const route = read("app/api/agent/actions/regenerate-channel/route.ts");
  const mediaBranch = route.slice(route.indexOf("const mediaModeByChannel"));

  assert.match(route, /INR_AGENT_IMAGES_PER_PUBLICATION/);
  assert.match(route, /const actionChannels = currentChannelsForAction\(action\)/);
  assert.match(
    route,
    /const expectedCount =\s*mediaKind === "image" \? INR_AGENT_IMAGES_PER_PUBLICATION : 1/,
  );
  assert.match(route, /for \(let index = 0; index < expectedCount; index \+= 1\)/);
  assert.match(route, /variantSeed: `\$\{actionId\}:global:\$\{mediaKind\}/);
  assert.match(route, /if \(generatedMedia\.length !== expectedCount\)/);
  assert.match(route, /Aucun média de la publication n’a été remplacé/);
  assert.match(
    mediaBranch,
    /const nextImagesByChannel = setChannelsValue\(imagesByChannel, actionChannels, nextImages\)/,
  );
  assert.match(
    mediaBranch,
    /const nextVideoByChannel = setChannelsValue\(videoByChannel, actionChannels, nextVideo\)/,
  );
  assert.match(
    mediaBranch,
    /const nextMediaModeByChannel = setChannelsValue\(mediaModeByChannel, actionChannels, nextMode\)/,
  );
  assert.match(mediaBranch, /for \(const targetChannel of actionChannels\)/);
  assert.match(mediaBranch, /nextPostByChannel\[targetChannel\] =/);
  assert.match(mediaBranch, /nextReadiness\[targetChannel\] = buildPublishMediaReadiness/);
  assert.match(mediaBranch, /nextAdaptation\[targetChannel\] = buildPublishMediaAdaptation/);
  assert.match(mediaBranch, /const globalMediaPatch = \{/);
  assert.match(mediaBranch, /mediaAssets: generatedMedia/);
  assert.match(mediaBranch, /image_assets: generatedMedia/);
  assert.match(mediaBranch, /imageAssets: generatedMedia/);
  assert.match(mediaBranch, /appliedToChannels: actionChannels/);
  assert.match(route, /previewText: action\.previewText/);
  assert.match(route, /editType: "regenerate_publish_global_media"/);
  assert.match(route, /scope: "publication"/);
  assert.doesNotMatch(
    mediaBranch,
    /setChannelValue\((?:imagesByChannel|videoByChannel|mediaModeByChannel), channel/,
  );
});

test("the review UI exposes independent content and media regeneration controls", () => {
  const ui = read("app/dashboard/agent/AgentClient.tsx");
  const styles = read("app/dashboard/agent/agent.module.css");

  assert.match(ui, /fetch\("\/api\/agent\/actions\/regenerate-channel"/);
  assert.match(ui, /requestPublishChannelRegeneration\("content"\)/);
  assert.match(ui, /requestPublishChannelRegeneration\("media"\)/);
  assert.match(ui, /regenerate_content_scope_title/);
  assert.match(ui, /regenerate_current_channel/);
  assert.match(ui, /regenerate_all_channels/);
  assert.match(ui, /onAlternateConfirm/);
  assert.match(ui, /scope === "publication"/);
  assert.match(ui, /regenerate_content/);
  assert.match(ui, /regenerate_media/);
  assert.match(ui, /i18nT\("regenerate_media_confirm"\)/);
  assert.match(ui, /i18nT\("regenerate_media_success"\)/);
  assert.match(ui, /i18nT\("agent_working_regenerating_media"\)/);
  assert.match(ui, /agent_working_regenerating/);
  assert.match(ui, /titre_et_texte_7f7b4e2a/);
  assert.match(ui, /publishTitleLoading/);
  assert.match(ui, /publishPreparationInProgress/);
  assert.match(
    ui,
    /const agentWorking =[\s\S]*?publishPreparationInProgress/,
  );
  assert.match(ui, /<AgentWorkingIndicator/);
  assert.match(styles, /\.publishRegenerateButton/);
  assert.match(styles, /\.publishTitleLoading/);
  assert.match(styles, /\.robotWorkingBadge/);
  assert.match(styles, /\.robotHaloWorking > img/);
  assert.match(
    styles,
    /\.agentCommandRailRobot \.robotWorkingSpinner[\s\S]*?width: 96px/,
  );

  for (const locale of [
    "fr-FR",
    "en-GB",
    "de-DE",
    "es-ES",
    "it-IT",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const messages = JSON.parse(read(`messages/${locale}/agent.json`)) as Record<string, string>;
    for (const key of [
      "regenerate_media_confirm",
      "regenerate_media_success",
      "agent_working_regenerating_media",
      "regenerate_content_scope_title",
      "regenerate_current_channel",
      "regenerate_all_channels",
      "regenerate_content_all_success",
      "agent_working_regenerating_all_content",
    ]) {
      assert.ok(messages[key]?.trim(), `${locale}.${key}`);
      if (key !== "regenerate_current_channel") {
        assert.doesNotMatch(messages[key], /\{channel\}/, `${locale}.${key}`);
      }
    }
  }
});

test("scheduled and immediate execution preserve channel-specific regenerated videos", () => {
  const schedule = read("app/api/agent/actions/schedule/route.ts");
  const execute = read("app/api/agent/actions/execute/route.ts");

  assert.match(schedule, /publishPayload\.videoByChannel/);
  assert.match(schedule, /videoByChannel: filteredVideoByChannel/);
  assert.match(schedule, /const sourceVideoByChannel = asRecord/);
  assert.match(execute, /asRecord\(payload\.videoByChannel\)/);
  assert.match(execute, /selectedChannels\.length === 1 \? selectedChannels\[0\] : undefined/);
});
