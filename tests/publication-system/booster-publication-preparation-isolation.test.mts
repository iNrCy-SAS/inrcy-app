import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  buildBoosterPublicationDispatchPlan,
  hasInvalidBoosterPublicationJson,
} from "../../lib/boosterPublicationDispatchPlan.ts";

const source = readFileSync("app/api/booster/publish-now/route.ts", "utf8");
const start = source.indexOf("    const invalidChannelData =");
const end = source.indexOf("      const { error: pubErr }", start);
assert.ok(start >= 0 && end > start, "extract the actual shared publication preparation");

const preparationCode = ts.transpileModule(
  `(() => {${source.slice(start, end)}
    return { publicationInsert, channelPreflightPlan, persistableChannels, persistableImageSettingsByChannel };
    }
  })()`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

const emptyImages = {
  images: [], publishableUrls: [], instagramPublishableUrls: [],
  socialFeedPublishableUrls: [], siteCardPublishableUrls: [], gmbPublishableUrls: [],
  storagePaths: [], publishableStoragePaths: [], socialFeedStoragePaths: [],
};

function prepare(
  selected: string[],
  contentByChannel: Record<string, string>,
  imageSettingsByChannel: Record<string, unknown> = {},
) {
  const failures: Record<string, unknown> = {};
  return vm.runInNewContext(preparationCode, {
    internalAsyncDispatch: false,
    selected,
    getChannelPost: (channel: string) => ({
      title: channel, content: contentByChannel[channel], cta: "", hashtags: [],
    }),
    postByChannel: {},
    imageSettingsByChannel,
    channelImageSets: {},
    activePreparationSelected: selected,
    baseImageSet: emptyImages,
    mediaModeByChannel: {},
    publicationVideo: null,
    publicationVideoByChannel: {},
    hasAnyVideoChannel: false,
    hasAnyImageChannel: false,
    hadAnyImageInput: false,
    buildOriginalImageAttachments: () => [],
    buildBoosterPublicationDispatchPlan,
    hasInvalidBoosterPublicationJson,
    preflightFailuresByChannel: failures,
    setPreflightFailure: (channel: string, failure: unknown) => { failures[channel] = failure; },
    publicationId: "publication",
    userId: "account",
    idea: "Shared idea",
    uploadErrors: [],
  }) as {
    publicationInsert: { content: string; media_metadata?: { inrSearch?: { post: { content: string } } } };
    channelPreflightPlan: ReturnType<typeof buildBoosterPublicationDispatchPlan>;
    persistableChannels: string[];
    persistableImageSettingsByChannel: Record<string, unknown>;
  };
}

test("a malformed first channel fails independently and a healthy sibling supplies the publication", () => {
  const preparation = prepare(["inr_search", "facebook"], {
    inr_search: "incomplete \uD83D", facebook: "Facebook intact 🙂",
  });
  assert.equal(preparation.publicationInsert.content, "Facebook intact 🙂");
  assert.equal(preparation.publicationInsert.media_metadata?.inrSearch, undefined);
  assert.equal(hasInvalidBoosterPublicationJson(preparation.publicationInsert), false);
  assert.deepEqual(Array.from(preparation.persistableChannels), ["facebook"]);
  assert.deepEqual(preparation.channelPreflightPlan.dispatchableChannels, ["facebook"]);
  assert.equal(preparation.channelPreflightPlan.entries[0].result?.code, "publication_channel_invalid_data");
});

test("an invalid later channel setting is kept out of shared persistence", () => {
  const preparation = prepare(
    ["facebook", "inr_search"],
    { facebook: "Facebook", inr_search: "Recherche 🙂" },
    { inr_search: { imageKeys: ["damaged\u0000key"] } },
  );
  assert.equal(preparation.publicationInsert.content, "Facebook");
  assert.equal(preparation.publicationInsert.media_metadata?.inrSearch, undefined);
  assert.deepEqual(Array.from(preparation.persistableChannels), ["facebook"]);
  assert.deepEqual(preparation.channelPreflightPlan.failedChannels, ["inr_search"]);
  assert.equal(Object.hasOwn(preparation.persistableImageSettingsByChannel, "inr_search"), false);
});

test("all malformed channels retain terminal failures and no dispatchable destination", () => {
  const preparation = prepare(["inr_search", "facebook"], {
    inr_search: "\uD83D", facebook: "\u0000",
  });
  assert.equal(preparation.publicationInsert.content, "");
  assert.equal(hasInvalidBoosterPublicationJson(preparation.publicationInsert), false);
  assert.equal(preparation.channelPreflightPlan.dispatchableChannels.length, 0);
  assert.deepEqual(preparation.channelPreflightPlan.failedChannels, ["inr_search", "facebook"]);
});

test("healthy channels keep their original order and iNrSearch snapshot", () => {
  const preparation = prepare(["inr_search", "facebook"], {
    inr_search: "Recherche 🙂", facebook: "Facebook",
  });
  assert.equal(preparation.publicationInsert.content, "Recherche 🙂");
  assert.equal(preparation.publicationInsert.media_metadata?.inrSearch?.post.content, "Recherche 🙂");
  assert.deepEqual(preparation.channelPreflightPlan.dispatchableChannels, ["inr_search", "facebook"]);
});

test("deferred parent preparation preserves delivery rows already created", () => {
  assert.match(source, /\.upsert\(deliveries, \{ onConflict: "id", ignoreDuplicates: true \}\)/);
});
