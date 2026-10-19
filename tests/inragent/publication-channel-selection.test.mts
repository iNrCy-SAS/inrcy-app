import assert from "node:assert/strict";
import test from "node:test";
import { filterInrAgentPublicationChannels, pendingInrAgentPublicationChannels, selectedInrAgentPublicationChannels, preparedInrAgentPublicationChannels, withInrAgentPublicationChannelSelection } from "../../lib/inrAgentPublicationChannelSelection.ts";
import { buildScheduledPublicationRequest } from "../../lib/inrAgentScheduledPublication.ts";

test("unchecking and rechecking retain every prepared text and media", () => {
  const original = { selectedChannels: ["site_web", "instagram"], channels: ["site_web", "instagram"], postByChannel: { instagram: { content: "Keep this caption" } }, imagesByChannel: { instagram: [{ id: "original-image" }] }, videoByChannel: { instagram: { id: "original-video" } } };
  const unchecked = withInrAgentPublicationChannelSelection(original, original.channels, ["site_web"]);
  assert.deepEqual(filterInrAgentPublicationChannels(unchecked, original.channels), ["site_web"]);
  assert.equal(unchecked.postByChannel, original.postByChannel);
  assert.equal(unchecked.imagesByChannel, original.imagesByChannel);
  assert.equal(unchecked.videoByChannel, original.videoByChannel);
  const restored = withInrAgentPublicationChannelSelection(unchecked, original.channels, original.channels);
  assert.deepEqual(filterInrAgentPublicationChannels(restored, original.channels), original.channels);
  assert.deepEqual(original.channels, ["site_web", "instagram"]);
});

test("zero selected never falls back to configured or scheduled channels", () => {
  const payload = withInrAgentPublicationChannelSelection({ publishPayload: { channels: ["facebook"], postByChannel: { facebook: { content: "Retained" } } } }, ["facebook"], []);
  assert.deepEqual(filterInrAgentPublicationChannels(payload, ["facebook"]), []);
  assert.equal(buildScheduledPublicationRequest({ id: "paused", channels: ["facebook"], payload }), null);
});

test("scheduled dispatch filters the final choice while retaining per-channel content", () => {
  const payload = withInrAgentPublicationChannelSelection({ publishPayload: { channels: ["instagram", "facebook"], postByChannel: { instagram: { content: "IG" }, facebook: { content: "FB" } }, videoByChannel: { instagram: { id: "video" } } } }, ["instagram", "facebook"], ["facebook"]);
  const request = buildScheduledPublicationRequest({ id: "future", channels: ["instagram", "facebook"], payload });
  assert.deepEqual(request?.body.channels, ["facebook"]);
  assert.deepEqual(request?.body.selectedChannels, ["facebook"]);
  assert.deepEqual(request?.body.postByChannel, payload.publishPayload && (payload.publishPayload as Record<string,unknown>).postByChannel);
});

test("aliases and saved available channels keep unchecked previews accessible", () => {
  const payload = withInrAgentPublicationChannelSelection({ channels: ["siteWeb", "youtube"] }, ["site_web", "youtube_shorts"], ["site_web"]);
  assert.deepEqual(filterInrAgentPublicationChannels(payload, ["siteWeb", "youtube"]), ["siteWeb"]);
  assert.deepEqual(preparedInrAgentPublicationChannels(payload, []), ["site_web", "youtube_shorts"]);
  assert.throws(() => withInrAgentPublicationChannelSelection({}, ["instagram"], ["unknown-channel"]));
  assert.throws(() => withInrAgentPublicationChannelSelection({}, ["instagram"], "instagram"));
});

test("checked empty channels are retained for review but never dispatched", () => {
  const payload=withInrAgentPublicationChannelSelection({postByChannel:{facebook:{content:"Existing"}}},["facebook"],["facebook","threads"]);
  assert.deepEqual(pendingInrAgentPublicationChannels(payload),["threads"]);
  assert.deepEqual(selectedInrAgentPublicationChannels(payload,["facebook"]),["facebook","threads"]);
  assert.deepEqual(filterInrAgentPublicationChannels(payload,["facebook","threads"]),["facebook"]);
  const unvalidated={...payload,publicationChannelSelection:{version:1,availableChannels:["facebook","threads"],excludedChannels:[],unvalidatedChannels:["threads"]}};
  assert.deepEqual(selectedInrAgentPublicationChannels(unvalidated,["facebook","threads"]),["facebook","threads"]);
  assert.deepEqual(filterInrAgentPublicationChannels(unvalidated,["facebook","threads"]),["facebook"]);
});
