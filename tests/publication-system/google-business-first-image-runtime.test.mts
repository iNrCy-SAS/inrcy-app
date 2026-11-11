import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import type * as Google from "../../lib/googleBusiness.ts";
import type * as ChannelContext from "../../app/api/booster/publish-now/publishNow.channel-context.ts";

const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
type RecordValue = Record<string, unknown>;
type CapturedPayload = { media?: Array<{ mediaFormat: string; sourceUrl: string }>; [key: string]: unknown };
type ExecutionResult = { gmb?: { ok?: boolean }; updatedInPlace?: boolean };
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const record = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const sources = Array.from({ length: 5 }, (_, i) => `https://cdn.example.test/source-${i + 1}.jpg`);
const prepared = sources.map((_, i) => `https://cdn.example.test/gmb-${i + 1}.jpg`);

function runtime() {
  const requests: Array<{ method: string; payload: CapturedPayload }> = [];
  const cache = new Map<string, { exports: unknown }>();
  function load<T>(relative: string): T {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file)!.exports as T;
    const moduleRecord = { exports: {} };
    cache.set(file, moduleRecord);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = (name: string): unknown => {
      if (name === "@/lib/googleStats" || name === "@/lib/googleBusinessLocations") return {};
      if (name.startsWith("@/") || name.startsWith(".")) {
        const target = name.startsWith("@/") ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(file), name);
        const resolved = [target, `${target}.ts`, `${target}.tsx`].find(p => existsSync(p) && statSync(p).isFile());
        assert.ok(resolved, name);
        return load(resolved);
      }
      return nativeRequire(name);
    };
    const fetch = async (_url: unknown, options: RequestInit) => {
      requests.push({ method: options.method || "GET", payload: JSON.parse(String(options.body)) });
      return Response.json({ name: "accounts/123/locations/456/localPosts/new" });
    };
    new Function("require", "module", "exports", "fetch", code)(require, moduleRecord, moduleRecord.exports, fetch);
    return moduleRecord.exports as T;
  }
  return { requests, google: load<typeof Google>("lib/googleBusiness.ts"), context: load<typeof ChannelContext>("app/api/booster/publish-now/publishNow.channel-context.ts") };
}

function sourceNode(file: string, predicate: (node: ts.Node, source: ts.SourceFile) => boolean) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (found) return; if (predicate(node, source)) { found = node; return; } ts.forEachChild(node, visit); };
  visit(source);
  assert.ok(found, `missing production fragment in ${file}`);
  return found.getText(source);
}

function execute(fragment: string, bindings: RecordValue, loop = false) {
  const body = loop ? `for (const ch of ["gmb"]) { ${fragment} } return results;` : fragment;
  const code = ts.transpileModule(`return (async () => { ${body} })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings)) as Promise<ExecutionResult>;
}

function imageSet(urls = sources, derivatives = prepared) {
  return { images: [...urls], publishableUrls: [...urls], gmbPublishableUrls: [...derivatives], instagramPublishableUrls: [...urls], socialFeedPublishableUrls: [...urls], siteCardPublishableUrls: [...urls], imageKeys: urls.map((_, i) => `image-${i + 1}`), storagePaths: [], publishableStoragePaths: [], socialFeedStoragePaths: [], editableAttachments: urls.map((url, i) => ({ name: `image-${i + 1}.jpg`, url, renderedUrl: url, publicUrl: url })) };
}

function fixture(options: { failProbe?: boolean; failRepair?: boolean; legacy?: boolean; derivatives?: string[]; urls?: string[]; currentUrls?: string[]; previousExternalId?: string } = {}) {
  const h = runtime();
  const urls = options.urls || sources;
  const selected = imageSet(urls, options.derivatives || prepared);
  const channelImageSets: Partial<Record<"gmb", ReturnType<typeof imageSet>>> = options.legacy ? {} : { gmb: selected };
  const imagesByChannel = { gmb: urls.map((publicUrl, i) => ({ name: `image-${i + 1}.jpg`, type: "image/jpeg", publicUrl })) };
  const context = h.context.createPublishNowImageContext({ publicationImageSet: selected, baseImageSet: selected, channelImageSets, imagesByChannel });
  const probes: string[][] = [], repairs: unknown[][] = [], mutations: string[] = [];
  const repairUrl = "https://cdn.example.test/repaired-first.jpg";
  const state = { connected: true, resource_id: "locations/456", account_name: "accounts/123" };
  const bindings: RecordValue = {
    ...context,
    asRecord: record, gmbRow: {}, liveChannelStates: { gmb: state }, publicationStates: { gmb: state },
    isOfficialPublicationChannelConnected: () => true, getGmbToken: async () => ({ accessToken: "synthetic-token" }),
    supabaseAdmin: {}, userId: "synthetic-account", publicationId: "synthetic-publication",
    mediaModeByChannel: { gmb: "images" }, channelImageSets, imagesByChannel, images: imagesByChannel.gmb,
    mediaType: "images", isVideoPublication: false, videoUrl: "", channelVideo: null,
    results: {}, uploadErrors: [], channelPost: {}, nextPost: {}, eventPayload: {}, publication: {},
    businessPhone: "", phone: "", websiteUrl: "", getPublicationWebsiteUrl: () => "",
    buildBoosterGmbSummary: () => "Texte choisi par le professionnel.", getBoosterGmbCallToAction: () => null,
    filterGoogleBusinessMediaUrls: async ({ urls: values }: { urls: string[] }) => {
      probes.push([...values]);
      return { acceptedUrls: options.failProbe && !values.includes(repairUrl) ? [] : [...values], rejected: [], probes: [] };
    },
    uploadImageSet: async (_user: string, inputs: unknown[]) => {
      repairs.push(inputs);
      return { imageSet: imageSet(urls, options.failRepair ? [] : [repairUrl]), uploadErrors: [] };
    },
    rebuildGoogleBusinessImagesFromSources: async (_user: string, values: string[]) => {
      repairs.push([...values]);
      return { urls: options.failRepair ? [] : [repairUrl], errors: [] };
    },
    gmbCreateLocalPost: async (args: Parameters<typeof Google.gmbCreateLocalPost>[0]) => { mutations.push("create"); return h.google.gmbCreateLocalPost(args); },
    gmbPatchLocalPost: async (args: Parameters<typeof Google.gmbPatchLocalPost>[0]) => { mutations.push("patch"); return h.google.gmbPatchLocalPost(args); },
    gmbDeleteLocalPost: async () => { mutations.push("delete"); },
    setDelivery: async () => {}, markAssetsMayBeInUse: () => {},
    toGoogleBusinessMediaProbeDiagnostics: () => [], describeGoogleBusinessMediaProbeFailures: () => "Première image inaccessible.",
    isGoogleBusinessPostOutcomeUnknown: () => false, isGoogleBusinessImageError: () => true, isGoogleBusinessMediaProviderError: () => true,
    getPublishChannelUserMessage: (_channel: string, error: Error) => error.message, logPublishChannelFailure: () => {},
    getChannelImageSet: context.getChannelImageSet,
    getEventPublicationMediaType: () => "images", getPublicationVideo: () => null,
    previousExternalId: options.previousExternalId || null, channel: "gmb", resolvedImageSet: selected,
  };
  return { ...h, bindings, probes, repairs, mutations, selected, channelImageSets, repairUrl, options, urls };
}

async function publish(h: ReturnType<typeof fixture>) {
  const file = "app/api/booster/publish-now/route.ts";
  const branch = sourceNode(file, (node, source) => ts.isIfStatement(node) && node.expression.getText(source) === 'ch === "gmb"' && node.getText(source).includes("let gmbWarning"));
  return execute(branch, h.bindings, true);
}

async function edit(h: ReturnType<typeof fixture>) {
  const file = "lib/inrsend/publicationChannelActions.ts";
  const selector = sourceNode(file, node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === "gmbImageUrls"));
  const equal = sourceNode(file, node => ts.isFunctionDeclaration(node) && node.name?.text === "areImageListsEqual");
  const branch = sourceNode(file, (node, source) => ts.isIfStatement(node) && node.expression.getText(source) === 'channel === "gmb"' && node.getText(source).includes("let gmbWarning"));
  return execute(`${equal}\nconst images = resolvedImageSet.images;\n${selector}\n${branch}`, {
    ...h.bindings,
    getChannelImageSet: () => imageSet(h.options.currentUrls || h.urls),
    errorMessage: (error: Error, fallback: string) => error?.message || fallback,
  });
}

test("the Google transport sends only image 1 and never mutates the five-image selection", async () => {
  const h = runtime();
  const selected = [...prepared];
  await h.google.gmbCreateLocalPost({ accessToken: "synthetic-token", accountName: "accounts/123", locationName: "locations/456", summary: "Texte choisi.", imageUrls: selected });
  assert.deepEqual(h.requests[0].payload.media, [{ mediaFormat: "PHOTO", sourceUrl: prepared[0] }]);
  assert.deepEqual(selected, prepared);
  await assert.rejects(h.google.gmbCreateLocalPost({ accessToken: "synthetic-token", accountName: "accounts/123", locationName: "locations/456", summary: "Texte choisi.", imageUrls: ["", prepared[1]] }), /première image/);
  assert.equal(h.requests.length, 1, "missing image 1 must not create a text-only post");
});

for (const [name, run] of [["Booster", publish], ["iNrSend", edit]] as const) {
  test(`${name} publishes image 1, keeps all five editable sources and reports no partial-image failure`, async () => {
    const h = fixture();
    const result = await run(h);
    assert.deepEqual(h.probes, [[prepared[0]]]);
    assert.deepEqual(h.requests[0].payload.media, [{ mediaFormat: "PHOTO", sourceUrl: prepared[0] }]);
    assert.deepEqual(h.selected.images, sources);
    assert.equal(h.selected.editableAttachments.length, 5);
    assert.equal(h.repairs.length, 0);
    assert.equal(JSON.stringify(result).includes("published_with_partial_images"), false);
  });

  test(`${name} follows the channel order after image 5 is moved to position 1`, async () => {
    const urls = [sources[4], ...sources.slice(0, 4)];
    const derivatives = [prepared[4], ...prepared.slice(0, 4)];
    const h = fixture({ urls, derivatives });
    await run(h);
    assert.equal(h.requests[0].payload.media?.[0]?.sourceUrl, prepared[4]);
    assert.deepEqual(h.selected.images, urls);
  });

  test(`${name} never substitutes a partial derivative list starting at image 2`, async () => {
    const h = fixture({ derivatives: prepared.slice(1) });
    await run(h);
    assert.equal(h.requests[0].payload.media?.[0]?.sourceUrl, sources[0]);
    assert.deepEqual(h.probes, [[sources[0]]]);
    assert.deepEqual(h.selected.images, sources);
  });

  test(`${name} repairs only the first source and preserves the five-image selection`, async () => {
    const h = fixture({ failProbe: true });
    await run(h);
    assert.equal(h.repairs.length, 1);
    assert.equal(h.repairs[0].length, 1);
    assert.equal(name === "Booster" ? record(h.repairs[0][0]).publicUrl : h.repairs[0][0], sources[0]);
    assert.equal(h.requests[0].payload.media?.[0]?.sourceUrl, h.repairUrl);
    assert.deepEqual(h.selected.images, sources);
    assert.deepEqual(h.channelImageSets.gmb?.images, sources);
  });

  test(`${name} blocks publication if image 1 cannot be repaired without trying images 2 to 5`, async () => {
    const h = fixture({ failProbe: true, failRepair: true });
    if (name === "Booster") assert.equal((await run(h)).gmb?.ok, false);
    else await assert.rejects(run(h), /aucune image/);
    assert.equal(h.requests.length, 0);
    assert.ok(h.probes.every(values => values.length === 1 && values[0] === prepared[0]));
    assert.ok(h.repairs.every(values => values.length === 1));
    assert.deepEqual(h.selected.images, sources);
  });
}

test("iNrSend edits images 2 to 5 without replacing the existing Google image", async () => {
  const h = fixture({ previousExternalId: "accounts/123/locations/456/localPosts/old", currentUrls: [sources[0], ...sources.slice(1).reverse()] });
  const result = await edit(h);
  assert.equal(result.updatedInPlace, true);
  assert.deepEqual(h.mutations, ["patch"]);
  assert.equal(h.requests[0].payload.media, undefined);
  assert.deepEqual(h.selected.images, sources);
});

test("iNrSend replaces a changed first image only after successful creation", async () => {
  const h = fixture({ previousExternalId: "accounts/123/locations/456/localPosts/old", currentUrls: [...sources].reverse() });
  await edit(h);
  assert.deepEqual(h.mutations, ["create", "delete"]);
  assert.equal(h.requests[0].payload.media?.[0]?.sourceUrl, prepared[0]);
  assert.deepEqual(h.selected.images, sources);
});

test("a legacy Booster repair keeps all five original images in the persisted channel set", async () => {
  const h = fixture({ legacy: true, failProbe: true });
  await publish(h);
  assert.equal(h.requests[0].payload.media?.[0]?.sourceUrl, h.repairUrl);
  assert.deepEqual(h.channelImageSets.gmb?.images, sources);
  assert.equal(h.channelImageSets.gmb?.editableAttachments.length, 5);
});

test("the shared channel resolver still supplies every selected photo to Facebook and Instagram", () => {
  const h = runtime();
  const selected = imageSet();
  const context = h.context.createPublishNowImageContext({ publicationImageSet: selected, baseImageSet: selected, channelImageSets: { facebook: selected, instagram: selected }, imagesByChannel: { facebook: sources.map(publicUrl => ({ name: "image.jpg", type: "image/jpeg", publicUrl })), instagram: sources.map(publicUrl => ({ name: "image.jpg", type: "image/jpeg", publicUrl })) } });
  for (const channel of ["facebook", "instagram"] as const) {
    assert.deepEqual(context.pickCompleteChannelImageUrls({ channel, candidates: ["images"], legacyFallback: [], limit: 5 }), sources);
    assert.equal(context.getExpectedChannelImageCount(channel), 5);
  }
});
