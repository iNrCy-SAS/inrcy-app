import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBoosterPublicHistoryUrl,
  isPrivateHistoryStoragePathOwned,
  parseHistoricalSupabaseSignedUrl,
  sanitizeInrSendHistoryStorageUrls,
} from "../../lib/inrsend/historyStorageUrls.ts";

const SUPABASE_URL = "https://project-ref.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function signedUrl(bucket: string, path: string, token = "historical-token") {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${encodedPath}?token=${token}`;
}

test("reconstruit les anciens liens signés Booster en URL publique durable", async () => {
  const historicalUrl = signedUrl(
    "booster",
    `${USER_ID}/booster-prepublish/photo été.jpg`,
  );
  const expected = `${SUPABASE_URL}/storage/v1/object/public/booster/${USER_ID}/booster-prepublish/photo%20%C3%A9t%C3%A9.jpg`;
  let privateResolutionCount = 0;

  const [item] = await sanitizeInrSendHistoryStorageUrls(
    [{
      id: "event-1",
      attachments: [{ url: historicalUrl, downloadUrl: historicalUrl }],
      detailHtml: `<img src="${historicalUrl}">`,
      raw: { payload: { images: [historicalUrl] } },
    }],
    {
      activeUserId: USER_ID,
      supabaseUrl: SUPABASE_URL,
      resolvePrivateUrl: async () => {
        privateResolutionCount += 1;
        return null;
      },
    },
  );

  assert.equal(item.attachments[0].url, expected);
  assert.equal(item.attachments[0].downloadUrl, expected);
  assert.equal(item.raw.payload.images[0], expected);
  assert.equal(item.detailHtml, `<img src="${expected}">`);
  assert.equal(privateResolutionCount, 0);
  assert.doesNotMatch(JSON.stringify(item), /historical-token|object\/sign/);
});

test("sonde et renouvelle un lien privé une seule fois par URL historique", async () => {
  const path = `users/${USER_ID}/workspace-source/image/photo.jpg`;
  const historicalUrl = signedUrl("inrcy-pro-media", path);
  const calls: Array<[string, string]> = [];
  const freshUrl = signedUrl("inrcy-pro-media", path, "fresh-token");

  const [item] = await sanitizeInrSendHistoryStorageUrls(
    [{
      id: "event-2",
      attachments: [{ url: historicalUrl, thumbnailUrl: historicalUrl }],
      raw: { payload: { image: historicalUrl } },
    }],
    {
      activeUserId: USER_ID,
      supabaseUrl: SUPABASE_URL,
      resolvePrivateUrl: async (bucket, storagePath) => {
        calls.push([bucket, storagePath]);
        return freshUrl;
      },
    },
  );

  assert.deepEqual(calls, [["inrcy-pro-media", path]]);
  assert.equal(item.attachments[0].url, freshUrl);
  assert.equal(item.attachments[0].thumbnailUrl, freshUrl);
  assert.equal(item.raw.payload.image, freshUrl);
  assert.doesNotMatch(JSON.stringify(item), /historical-token/);
});

test("retourne null pour un objet privé absent et pour un média marqué removed", async () => {
  const path = `users/${USER_ID}/workspace-source/image/missing.jpg`;
  const historicalUrl = signedUrl("inrcy-pro-media", path);
  let calls = 0;

  const [item] = await sanitizeInrSendHistoryStorageUrls(
    [{
      id: "event-3",
      attachments: [
        { url: historicalUrl },
        { upload_status: "removed", url: historicalUrl },
      ],
      raw: { payload: { image: historicalUrl } },
    }],
    {
      activeUserId: USER_ID,
      supabaseUrl: SUPABASE_URL,
      resolvePrivateUrl: async () => {
        calls += 1;
        return null;
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(item.attachments[0].url, null);
  assert.equal(item.attachments[1].url, null);
  assert.equal(item.raw.payload.image, null);
  assert.doesNotMatch(JSON.stringify(item), /historical-token/);
});

test("ne signe jamais un chemin privé appartenant à un autre compte", async () => {
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  const historicalUrl = signedUrl(
    "inrcy-pro-media",
    `users/${otherUserId}/workspace-source/image/private.jpg`,
  );
  let calls = 0;

  const [item] = await sanitizeInrSendHistoryStorageUrls(
    [{ id: "event-4", attachments: [{ url: historicalUrl }] }],
    {
      activeUserId: USER_ID,
      supabaseUrl: SUPABASE_URL,
      resolvePrivateUrl: async () => {
        calls += 1;
        return "https://should-not-be-used.test";
      },
    },
  );

  assert.equal(calls, 0);
  assert.equal(item.attachments[0].url, null);
  assert.equal(
    isPrivateHistoryStoragePathOwned(USER_ID, `users/${USER_ID}/media/file.jpg`),
    true,
  );
  assert.equal(
    isPrivateHistoryStoragePathOwned(USER_ID, `users/${otherUserId}/media/file.jpg`),
    false,
  );
});

test("supprime un lien signé d'un autre projet et conserve les URL externes", async () => {
  const foreignSignedUrl =
    "https://foreign-project.supabase.co/storage/v1/object/sign/booster/file.jpg?token=old";
  const externalUrl = "https://cdn.example.test/image.jpg";

  const [item] = await sanitizeInrSendHistoryStorageUrls(
    [{
      id: "event-5",
      attachments: [{ url: foreignSignedUrl }, { url: externalUrl }],
    }],
    {
      activeUserId: USER_ID,
      supabaseUrl: SUPABASE_URL,
      resolvePrivateUrl: async () => null,
    },
  );

  assert.equal(item.attachments[0].url, null);
  assert.equal(item.attachments[1].url, externalUrl);
});

test("parse les formes object/sign et render/image/sign sans conserver la query", () => {
  const path = `${USER_ID}/folder/image name.jpg`;
  assert.deepEqual(
    parseHistoricalSupabaseSignedUrl(signedUrl("booster", path), SUPABASE_URL),
    { bucket: "booster", path },
  );
  assert.deepEqual(
    parseHistoricalSupabaseSignedUrl(
      `/storage/v1/render/image/sign/booster/${USER_ID}/folder/image%20name.jpg?token=old&width=800`,
      SUPABASE_URL,
    ),
    { bucket: "booster", path },
  );
  assert.equal(
    buildBoosterPublicHistoryUrl(SUPABASE_URL, `${USER_ID}/folder/image name.jpg`),
    `${SUPABASE_URL}/storage/v1/object/public/booster/${USER_ID}/folder/image%20name.jpg`,
  );
});

test("la route d'historique applique la sanitation après les URLs de documents", () => {
  const route = readFileSync(
    new URL("../../app/api/inrsend/history/route.ts", import.meta.url),
    "utf8",
  );
  const statsHydration = route.indexOf("await withStatsReportContentUrls(items)");
  const storageSanitation = route.indexOf(
    "items = await sanitizeInrSendHistoryStorageUrls(items",
  );

  assert.ok(statsHydration >= 0);
  assert.ok(storageSanitation > statsHydration);
  assert.match(route, /createSafeStorageSignedUrl\(/);
  assert.doesNotMatch(route, /probeStorageObject\(bucket, storagePath\)/);
});
