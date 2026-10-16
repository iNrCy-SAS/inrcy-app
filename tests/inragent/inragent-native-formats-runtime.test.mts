import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { runtimeModules } from "./runtime-module-loader.mts";
import { buildInrAgentMediaFormatPlan, bindInrAgentMediaFormatVariants, inrAgentChannelImages, inrAgentImagesForPlacement } from "../../lib/inrAgentMediaFormats.ts";
import { buildInrAgentMediaGenerationRequest } from "../../lib/inrAgentMediaRequest.ts";
import { resolveInrAgentMediaMix } from "../../lib/inrAgentMediaMix.ts";
import type { BoosterImageChannel } from "../../lib/boosterImageDecision.ts";
import type { AiMediaLibraryPickerItem } from "../../lib/aiMediaGenerationContracts.ts";

type Media = Record<string, unknown>;
const feedChannels = ["site_web", "inr_search", "gmb", "facebook", "instagram", "linkedin", "threads", "pinterest", "x"];
const account = "636340f6-2017-4b1c-b698-49b3e1c7c482";

test("one feed image serves compatible photo destinations, TikTok is fullscreen by default, and all videos share one format", () => {
  const feed = buildInrAgentMediaFormatPlan({ kind: "image", channels: feedChannels });
  assert.deepEqual(feed.formats, ["portrait"]);
  assert.ok(Object.values(feed.byChannel).every((format) => format === "portrait"));
  const all = buildInrAgentMediaFormatPlan({ kind: "image", channels: [...feedChannels, "tiktok"] });
  assert.deepEqual(all.formats, ["portrait", "story"]);
  assert.equal(all.byChannel.tiktok, "story");
  assert.deepEqual(buildInrAgentMediaFormatPlan({ kind: "image", channels: ["tiktok"] }).formats, ["story"]);
  assert.deepEqual(buildInrAgentMediaFormatPlan({ kind: "image", channels: [...feedChannels, "tiktok"], payload: { tiktokPhotoFullScreen: false } }).formats, ["portrait"]);
  assert.deepEqual(buildInrAgentMediaFormatPlan({ kind: "video", channels: [...feedChannels, "tiktok", "youtube_shorts"] }).formats, ["story"]);
  assert.deepEqual(buildInrAgentMediaFormatPlan({ kind: "image", channels: ["facebook", "site_web", "gmb"] }).formats, ["portrait"], "Web and Google must not automatically buy a landscape version");
});

test("Classic plus Story uses only two formats and each destination selects exactly its own image series", () => {
  const payload = { facebookPublicationSettings: { primaryPlacement: "classic", includeStory: true }, instagramPublicationSettings: { placement: "story" }, tiktokPhotoFullScreen: true };
  const plan = buildInrAgentMediaFormatPlan({ kind: "image", channels: ["facebook", "instagram", "tiktok", "linkedin"], payload });
  assert.deepEqual(plan.formats, ["portrait", "story"]);
  const portrait = [{ id: "p1" }, { id: "p2" }, { id: "p3" }], story = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
  const bound = bindInrAgentMediaFormatVariants({ variants: { version: 1, kind: "image", defaultFormat: "portrait", byFormat: { portrait, story } }, channels: Object.keys(plan.byChannel), payload });
  assert.equal(bound.imagesByChannel.facebook, portrait);
  assert.equal(bound.imagesByChannel.instagram, story);
  assert.equal(bound.imagesByChannel.tiktok, story);
  assert.equal(inrAgentChannelImages(bound, "instagram"), story);
  assert.deepEqual(inrAgentChannelImages(bound), portrait, "A fallback must not merge six images into one carousel");
  assert.deepEqual(inrAgentChannelImages({ imagesByChannel: { instagram: [] }, images: portrait }, "instagram"), [], "An explicit empty selection stays empty");
  assert.equal(inrAgentImagesForPlacement({ source: "inr_agent", imagesByPlacement: bound.imagesByPlacement, channel: "facebook", placement: "story", fallback: portrait }), story);
  assert.equal(inrAgentImagesForPlacement({ source: "booster", imagesByPlacement: bound.imagesByPlacement, channel: "facebook", placement: "story", fallback: portrait }), portrait, "Booster's original-first path is unchanged");
});

test("channel grouping overrides only the output format and retains Studio creative and audio choices", () => {
  for (const kind of ["image", "video"] as const) {
    const mix = resolveInrAgentMediaMix({ kind, theme: "conseils", studioMediaPreferencePercent: 0, seed: "stable-creative-identity", maxVideoDurationSeconds: 8 });
    const before = structuredClone(mix);
    const request = buildInrAgentMediaGenerationRequest({ requestId: "native-shape-test", idea: "Un conseil métier concret", theme: "conseils", kind, mediaMix: mix, outputFormat: kind === "image" ? "portrait" : "story", videoDurationSeconds: kind === "video" ? 8 : undefined });
    assert.equal(request.format, kind === "image" ? "portrait" : "story");
    assert.equal(request.visualStyle, mix.visualStyle);
    assert.equal(request.withNarration, kind === "video" ? mix.withNarration : false);
    assert.deepEqual(mix, before);
  }
});

const services = { "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: () => ({
  download: async () => ({ error: new Error("No live Storage in a framing test") }),
  getPublicUrl: () => ({ data: { publicUrl: "" } }),
}) } } } };
const load = runtimeModules(services);
const { prepareBoosterImagesByChannelOnServer: prepare } = load<typeof import("../../lib/boosterImageServerPreparation.ts")>("lib/boosterImageServerPreparation.ts");
const { normalizeGeneratedAiImage } = load<typeof import("../../lib/aiMediaNormalizer.ts")>("lib/aiMediaNormalizer.ts");
const { resolveAiMediaNativeImageSize } = load<typeof import("../../lib/aiMediaImageProviderRequest.ts")>("lib/aiMediaImageProviderRequest.ts");

async function photo(width: number, height: number) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#2478b8"/><rect width="48" height="48" fill="#dc2828"/><rect x="${width - 48}" width="48" height="48" fill="#22aa66"/><rect y="${height - 48}" width="48" height="48" fill="#3355dd"/><rect x="${width - 48}" y="${height - 48}" width="48" height="48" fill="#ddaa22"/></svg>`)).jpeg({ progressive: false, chromaSubsampling: "4:2:0" }).toBuffer();
}
async function source(width: number, height: number) {
  const buffer = await photo(width, height);
  return { name: "studio.jpg", type: "image/jpeg", dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    imageKey: "image-1", imageMeta: { width, height, source: "ai_media_generation" } };
}
async function assertWholeImage(dataUrl: string, width: number, height: number) {
  const { data, info } = await sharp(Buffer.from(dataUrl.split(",")[1], "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [width, height]);
  for (const [x, y, expected] of [[8, 8, [220, 40, 40]], [width - 9, 8, [34, 170, 102]], [8, height - 9, [51, 85, 221]], [width - 9, height - 9, [221, 170, 34]]] as Array<[number, number, number[]]>) {
    const at = (y * width + x) * info.channels;
    assert.ok(expected.every((value, channel) => Math.abs(value - data[at + channel]) < 16), `Corner marker ${x},${y} must remain in the full image`);
  }
}

test("every feed channel preserves the entire native image, including all four edge markers", async () => {
  const input = await source(480, 600);
  const prepared = await prepare({ channels: feedChannels as BoosterImageChannel[], images: [input], automaticFit: "contain", preserveSourceComposition: true });
  assert.deepEqual(prepared.failuresByChannel, {});
  for (const channel of feedChannels as BoosterImageChannel[]) await assertWholeImage(prepared.imagesByChannel[channel]![0].dataUrl!, 480, 600);
  const story = await prepare({ channels: ["instagram", "facebook", "tiktok"], images: [await source(360, 640)], preserveSourceComposition: true,
    placementsByChannel: { instagram: "story", facebook: "story" } });
  assert.deepEqual(story.failuresByChannel, {});
  for (const channel of ["instagram", "facebook", "tiktok"] as const) await assertWholeImage(story.imagesByChannel[channel]![0].dataUrl!, 360, 640);
});

test("Agent refuses an incompatible generated image rather than silently adding padding or cropping; Booster keeps its current policy", async () => {
  const input = await source(395, 500);
  const protectedOutput = await prepare({ channels: ["instagram"], images: [input], preserveSourceComposition: true });
  assert.equal(protectedOutput.failuresByChannel.instagram?.code, "agent_image_format_requires_generation");
  assert.equal(protectedOutput.failuresByChannel.instagram?.retryable, false);
  assert.equal(protectedOutput.imagesByChannel.instagram, undefined);
  const booster = await prepare({ channels: ["instagram"], images: [input] });
  assert.deepEqual(booster.failuresByChannel, {});
  assert.equal((booster.imagesByChannel.instagram![0].transform as { fit: string }).fit, "cover");
});

test("Agent requests exact native provider canvases and refuses a wrong provider frame before a destructive resize", async () => {
  for (const [format, ratio] of [["portrait", 4 / 5], ["story", 9 / 16], ["landscape", 16 / 9], ["square", 1]] as const) {
    const [width, height] = resolveAiMediaNativeImageSize(format).split("x").map(Number);
    assert.equal(width / height, ratio);
    assert.equal(width % 16, 0); assert.equal(height % 16, 0);
  }
  const accepted = await normalizeGeneratedAiImage(await photo(480, 600), { width: 480, height: 600, preserveComposition: true });
  await assertWholeImage(`data:image/jpeg;base64,${accepted.buffer.toString("base64")}`, 480, 600);
  await assert.rejects(normalizeGeneratedAiImage(await photo(400, 600), { width: 480, height: 600, preserveComposition: true }), /ai_image_native_frame_mismatch/);
});

function formatGeneration(failAt = 0) {
  const jobs = new Map<string, AiMediaLibraryPickerItem>();
  const calls: string[] = [];
  let failed = false;
  const loader = runtimeModules({
    "@/lib/aiUsageQuota": { isAdminUserForAi: async () => false },
    "@/lib/inrAgentMediaPreferencesServer": { loadInrAgentStudioMediaPreferences: async () => null },
    "@/lib/inrAgentMediaGeneration": { generateInrAgentMedia: async (args: Parameters<typeof import("../../lib/inrAgentMediaGeneration.ts").generateInrAgentMedia>[0]) => {
      const key = args.generationRequestId!;
      if (jobs.has(key)) return { item: jobs.get(key), outcome: "generated", kind: args.kind };
      calls.push(key);
      if (!failed && calls.length === failAt) { failed = true; return { item: null, outcome: "quota_reached", kind: args.kind }; }
      const item: AiMediaLibraryPickerItem = { id: `created-${jobs.size}`, bucket_name: "inrcy-pro-media", storage_path: `users/${account}/ai-generated/${args.kind}/${jobs.size}.jpg`, media_type: args.kind,
        mime_type: "image/jpeg", size_bytes: 1024, title: "Native version", tags: [], width: 360, height: 640, duration_seconds: null, created_at: null, signed_url: null };
      jobs.set(key, item); return { item, outcome: "generated", kind: args.kind };
    } },
  });
  const { ensureInrAgentMediaFormats } = loader<typeof import("../../lib/inrAgentMediaFormatGeneration.ts")>("lib/inrAgentMediaFormatGeneration.ts");
  const run = (payload: Media, rebindChannels?: string[], allowGeneration?: boolean) => ensureInrAgentMediaFormats({ accountId: account, actorAuthUserId: "actor", actionId: "action", supabase: {} as Parameters<typeof ensureInrAgentMediaFormats>[0]["supabase"],
    payload, channels: ["facebook", "instagram"], rebindChannels, allowGeneration });
  return { run, calls, jobs };
}
const basePayload = () => {
  const portrait = [0, 1, 2].map((index) => ({ id: `original-${index}`, width: 480, height: 600, storagePath: `users/${account}/ai-generated/image/${index}.jpg`, kind: "image", source: "ai_media_generation" }));
  return { idea: "Montrer les détails d’une cuisine", theme: "realisations", images: portrait, mediaAssets: portrait, mediaType: "image",
    facebookPublicationSettings: { primaryPlacement: "classic", includeStory: true },
    ...bindInrAgentMediaFormatVariants({ variants: { version: 1, kind: "image", defaultFormat: "portrait", byFormat: { portrait } }, channels: ["facebook", "instagram"] }) };
};

test("one vertical carousel is generated once and reused for both Meta Story destinations, without changing the feed originals", async () => {
  const h = formatGeneration(), original = basePayload(), snapshot = structuredClone(original);
  const first = await h.run(original, ["facebook"]);
  assert.deepEqual(first.createdFormats, ["story"]);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(original, snapshot);
  const second = await h.run({ ...first.payload, instagramPublicationSettings: { placement: "story" } }, ["instagram"]);
  assert.deepEqual(second.createdFormats, []);
  assert.equal(h.calls.length, 3, "Reusing the cached format makes no additional provider call");
  assert.deepEqual((second.payload.imagesByChannel as Record<string, Media[]>).facebook.map((item) => item.id), ["original-0", "original-1", "original-2"]);
  assert.deepEqual((second.payload.imagesByChannel as Record<string, Media[]>).instagram.map((item) => item.id), ["created-0", "created-1", "created-2"]);
});

test("a partially failed additional format retains old selections and replays the already obtained parts", async () => {
  const h = formatGeneration(2), original = basePayload(), snapshot = structuredClone(original);
  await assert.rejects(h.run(original), /Crédits média insuffisants/);
  assert.deepEqual(original, snapshot);
  assert.equal(h.jobs.size, 1);
  const retry = await h.run(original);
  assert.deepEqual(retry.createdFormats, ["story"]);
  assert.equal(h.jobs.size, 3);
  assert.equal(h.calls.length, 4, "One failed call plus three successes; the first paid success is never generated twice");
});

test("validation and scheduling never buy an unseen format, while a cached format can be reused without a provider call", async () => {
  const h = formatGeneration(), original = basePayload();
  await assert.rejects(h.run(original, undefined, false), /Créez-la dans l’aperçu/);
  assert.equal(h.calls.length, 0);
  const cached = await h.run(original);
  const calls = h.calls.length;
  assert.deepEqual((await h.run(cached.payload, undefined, false)).createdFormats, []);
  assert.equal(h.calls.length, calls);
});

test("a professional's manual media replacement stays authoritative when changing placement", async () => {
  const h = formatGeneration();
  const payload = { ...basePayload(), mediaFormatVariants: null, lastManualEdit: { editType: "publish_channel_media" } };
  const result = await h.run(payload);
  assert.equal(result.payload, payload);
  assert.equal(h.calls.length, 0);
});

test("Agent preparation isolates unavailable channels and keeps the native Story separate through durable queuing", async () => {
  const { prepareInrAgentPublicationImages } = load<typeof import("../../lib/inrAgentMediaPreparation.ts")>("lib/inrAgentMediaPreparation.ts");
  const { buildDurablePreparationInput, normalizeClientPreflightFailuresByChannel } = load<typeof import("../../lib/boosterPublicationIngress.ts")>("lib/boosterPublicationIngress.ts");
  const portrait = await source(480, 600), story = await source(360, 640);
  const payload = { facebookPublicationSettings: { primaryPlacement: "classic", includeStory: true },
    imagesByPlacement: { facebook: { classic: [portrait], story: [story] } } };
  const prepared = await prepareInrAgentPublicationImages({ accountId: account, channels: ["facebook", "linkedin"], payload,
    readImages: async (channel, override) => {
      if (channel === "linkedin") throw new Error("Unavailable source");
      return (override || [portrait]) as typeof portrait[];
    } });
  await assertWholeImage(prepared.imagesByChannel.facebook![0].dataUrl!, 480, 600);
  await assertWholeImage(prepared.imagesByPlacement.facebook.story[0].dataUrl!, 360, 640);
  assert.equal(prepared.imagesByChannel.linkedin, undefined);
  const failures = normalizeClientPreflightFailuresByChannel(prepared.failuresByChannel, ["facebook", "linkedin"]);
  assert.equal(failures.linkedin?.ok, false);
  assert.equal(failures.facebook, undefined);
  const queued = buildDurablePreparationInput({ source: "inr_agent", ...payload, ...prepared });
  const selected = inrAgentImagesForPlacement<typeof portrait>({ source: queued.source, imagesByPlacement: queued.imagesByPlacement,
    channel: "facebook", placement: "story", fallback: prepared.imagesByChannel.facebook! as typeof portrait[] });
  await assertWholeImage(selected[0].dataUrl!, 360, 640);
});
