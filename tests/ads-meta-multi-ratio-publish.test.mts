import assert from "node:assert/strict";
import test from "node:test";
import {
  metaAssetFeedSpec,
  metaCreativeAssetUrls,
  metaPlacementTargeting,
} from "../lib/adsMetaPlacement.ts";
import {
  executeMetaAdsGraphPublish,
  metaUrlTags,
  MetaAdsPublishError,
  type MetaAdsGraphPublishInput,
  type MetaAdsPublishProgress,
} from "../lib/adsMetaPublishCore.ts";

type GraphCall = {
  path: string;
  body: Record<string, string> | null;
};

const FEED_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VERTICAL_HASH = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function publishInput(overrides: Partial<MetaAdsGraphPublishInput> = {}): MetaAdsGraphPublishInput {
  const placements = overrides.placements || ["facebook_feed", "instagram_feed", "stories", "reels"];
  return {
    userId: "user-1",
    adAccountId: "1234567890",
    pageId: "9988776655",
    instagramUserId: "17841400000000000",
    name: "Meta · Offre locale",
    destinationUrl: "https://example.com/offre",
    primaryText: "Découvrez notre offre locale et demandez votre devis.",
    headline: "Votre devis local",
    description: "Une réponse claire et rapide.",
    dailyBudgetCents: 1_250,
    endTime: "2026-12-01T23:59:59+01:00",
    placements,
    targeting: metaPlacementTargeting(placements),
    urlTags: "utm_source=meta&utm_campaign=offre_locale",
    feedImageBytes: Buffer.from("feed-original-bytes").toString("base64"),
    storyReelImageBytes: Buffer.from("vertical-original-bytes").toString("base64"),
    activate: false,
    ...overrides,
  };
}

function graphHarness(options: { failCampaignActivation?: boolean } = {}) {
  const calls: GraphCall[] = [];
  let uploadIndex = 0;
  const graph = async (_userId: string, path: string, body?: URLSearchParams): Promise<Record<string, unknown>> => {
    const fields = body ? Object.fromEntries(body.entries()) : null;
    calls.push({ path, body: fields });

    if (path.endsWith("/adimages")) {
      uploadIndex += 1;
      return uploadIndex === 1
        ? { images: { bytes: { hash: FEED_HASH } } }
        : { images: { bytes: { hash: VERTICAL_HASH, id: `1234567890:${VERTICAL_HASH}` } } };
    }
    if (path.endsWith("/campaigns")) return { id: "111" };
    if (path.endsWith("/adsets")) return { id: "222" };
    if (path.endsWith("/adcreatives")) return { id: "333" };
    if (path.endsWith("/ads")) return { id: "444" };
    if (path === "111" && fields?.status === "ACTIVE" && options.failCampaignActivation) {
      throw new Error("timeout pendant l’activation");
    }
    if (["111", "222", "444"].includes(path) && (fields?.status === "ACTIVE" || fields?.status === "PAUSED")) {
      return { success: true };
    }
    throw new Error(`Appel Graph inattendu : ${path}`);
  };
  return { calls, graph };
}

test("Meta cible exactement les fils, Stories et Reels sélectionnés", () => {
  assert.deepEqual(metaPlacementTargeting(["facebook_feed", "stories", "reels"]), {
    age_min: 18,
    geo_locations: { countries: ["FR"] },
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story", "facebook_reels"],
    instagram_positions: ["story", "reels"],
  });
  assert.throws(
    () => metaPlacementTargeting(["messenger"]),
    /Messenger n’est pas encore pris en charge/,
  );
});

test("les balises Meta deviennent url_tags sans accepter une URL ou un fragment", () => {
  assert.equal(metaUrlTags("?utm_source=meta&utm_campaign=offre_locale"), "utm_source=meta&utm_campaign=offre_locale");
  assert.throws(() => metaUrlTags("https://example.com/?utm_source=meta"), /invalides/);
  assert.throws(() => metaUrlTags("utm_source=meta#fragment"), /invalides/);
  assert.throws(() => metaUrlTags("utm_source"), /cle=valeur/);
});

test("Meta refuse un placement vertical sans visuel 9:16 au lieu de recadrer le fil", () => {
  assert.deepEqual(metaCreativeAssetUrls({
    placements: ["facebook_feed"],
    imageUrl: "https://example.com/legacy-feed.jpg",
  }), {
    feedImageUrl: "https://example.com/legacy-feed.jpg",
    storyReelImageUrl: "",
  });
  assert.throws(() => metaCreativeAssetUrls({
    placements: ["stories"],
    imageUrl: "https://example.com/legacy-feed.jpg",
  }), /vertical 9:16/);
  assert.throws(() => metaAssetFeedSpec({
    placements: ["facebook_feed", "stories"],
    destinationUrl: "https://example.com",
    primaryText: "Texte publicitaire suffisamment long.",
    headline: "Titre",
    feedImageHash: FEED_HASH,
  }), /vertical 9:16/);
  assert.throws(() => metaAssetFeedSpec({
    placements: ["facebook_feed", "stories"],
    destinationUrl: "https://example.com",
    primaryText: "Texte publicitaire suffisamment long.",
    headline: "Titre",
    feedImageHash: FEED_HASH,
    storyReelImageHash: FEED_HASH,
  }), /deux images distinctes/);
});

test("le publisher mocké importe les deux octets puis crée une creative personnalisée par placement", async () => {
  const { calls, graph } = graphHarness();
  const persisted: MetaAdsPublishProgress[] = [];
  const input = publishInput();

  const result = await executeMetaAdsGraphPublish(input, graph, async (resources) => {
    persisted.push(structuredClone(resources) as MetaAdsPublishProgress);
  });

  assert.deepEqual(calls.map((call) => call.path), [
    "act_1234567890/adimages",
    "act_1234567890/adimages",
    "act_1234567890/campaigns",
    "act_1234567890/adsets",
    "act_1234567890/adcreatives",
    "act_1234567890/ads",
  ]);
  assert.equal(calls[0].body?.bytes, input.feedImageBytes);
  assert.equal(calls[1].body?.bytes, input.storyReelImageBytes);
  assert.notEqual(calls[0].body?.bytes, calls[1].body?.bytes);

  assert.equal(calls[2].body?.status, "PAUSED");
  assert.equal(calls[3].body?.status, "PAUSED");
  assert.equal(calls[5].body?.status, "PAUSED");
  assert.deepEqual(JSON.parse(calls[3].body!.targeting), input.targeting);

  const creative = calls[4].body!;
  assert.equal(creative.link_url, "https://example.com/offre");
  assert.equal(creative.url_tags, "utm_source=meta&utm_campaign=offre_locale");
  assert.deepEqual(JSON.parse(creative.object_story_spec), {
    page_id: "9988776655",
    instagram_user_id: "17841400000000000",
  });
  const assetFeed = JSON.parse(creative.asset_feed_spec) as {
    images: Array<{ hash: string; adlabels: Array<{ name: string }> }>;
    optimization_type: string;
    asset_customization_rules: unknown[];
  };
  assert.equal(assetFeed.optimization_type, "PLACEMENT");
  assert.deepEqual(assetFeed.images, [
    { hash: FEED_HASH, adlabels: [{ name: "inrcy_feed_image" }] },
    { hash: VERTICAL_HASH, adlabels: [{ name: "inrcy_story_reel_image" }] },
  ]);
  assert.deepEqual(assetFeed.asset_customization_rules, [
    {
      customization_spec: {
        publisher_platforms: ["facebook", "instagram"],
        facebook_positions: ["feed"],
        instagram_positions: ["stream"],
      },
      image_label: { name: "inrcy_feed_image" },
      priority: 1,
    },
    {
      customization_spec: {
        publisher_platforms: ["facebook", "instagram"],
        facebook_positions: ["story", "facebook_reels"],
        instagram_positions: ["story", "reels"],
      },
      image_label: { name: "inrcy_story_reel_image" },
      priority: 2,
    },
  ]);

  assert.deepEqual(persisted.map((entry) => entry.stage), [
    "feed_image_uploaded",
    "story_reel_image_uploaded",
    "campaign_created",
    "adset_created",
    "creative_created",
    "ad_created",
    "demo_paused",
  ]);
  assert.deepEqual(persisted[0].imageAssets?.feed, {
    hash: FEED_HASH,
    id: `1234567890:${FEED_HASH}`,
  });
  assert.deepEqual(persisted[1].imageAssets?.storyReel, {
    hash: VERTICAL_HASH,
    id: `1234567890:${VERTICAL_HASH}`,
  });
  assert.equal(result.stage, "demo_paused");
});

test("une campagne feed-only n’importe qu’un asset et active la campagne en dernier", async () => {
  const { calls, graph } = graphHarness();
  const input = publishInput({
    placements: ["facebook_feed"],
    targeting: metaPlacementTargeting(["facebook_feed"]),
    instagramUserId: undefined,
    storyReelImageBytes: undefined,
    activate: true,
  });

  const result = await executeMetaAdsGraphPublish(input, graph, async () => {});
  assert.equal(calls.filter((call) => call.path.endsWith("/adimages")).length, 1);
  const creativeCall = calls.find((call) => call.path.endsWith("/adcreatives"));
  const identity = JSON.parse(creativeCall!.body!.object_story_spec);
  const assetFeed = JSON.parse(creativeCall!.body!.asset_feed_spec);
  assert.deepEqual(identity, { page_id: "9988776655" });
  assert.equal(assetFeed.images.length, 1);
  assert.equal(assetFeed.images[0].hash, FEED_HASH);
  assert.equal("adlabels" in assetFeed.images[0], false);
  assert.equal("asset_customization_rules" in assetFeed, false);

  const activationCalls = calls.filter((call) => call.body?.status === "ACTIVE");
  assert.deepEqual(activationCalls.map((call) => call.path), ["444", "222", "111"]);
  assert.equal(result.stage, "active");
});

test("si l’activation finale est ambiguë, le publisher remet la campagne en pause", async () => {
  const { calls, graph } = graphHarness({ failCampaignActivation: true });
  const input = publishInput({ activate: true });

  await assert.rejects(
    () => executeMetaAdsGraphPublish(input, graph, async () => {}),
    (error: unknown) => {
      assert.ok(error instanceof MetaAdsPublishError);
      assert.equal(error.campaignMayBeActive, false);
      assert.equal(error.progress.stage, "needs_review");
      assert.equal(error.progress.campaignId, "111");
      return true;
    },
  );
  const campaignStatusCalls = calls.filter((call) => call.path === "111");
  assert.deepEqual(campaignStatusCalls.map((call) => call.body?.status), ["ACTIVE", "PAUSED"]);
});

test("un échec de persistance après upload conserve le hash dans l’erreur de reprise", async () => {
  const { calls, graph } = graphHarness();
  const input = publishInput({
    placements: ["facebook_feed"],
    targeting: metaPlacementTargeting(["facebook_feed"]),
    instagramUserId: undefined,
    storyReelImageBytes: undefined,
  });

  await assert.rejects(
    () => executeMetaAdsGraphPublish(input, graph, async () => {
      throw new Error("base indisponible");
    }),
    (error: unknown) => {
      assert.ok(error instanceof MetaAdsPublishError);
      assert.equal(error.progress.stage, "needs_review");
      assert.equal(error.progress.imageAssets?.feed?.hash, FEED_HASH);
      assert.match(error.message, /Aucune campagne Meta n’a été activée/);
      return true;
    },
  );
  assert.deepEqual(calls.map((call) => call.path), ["act_1234567890/adimages"]);
});
