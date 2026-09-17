import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authorizeStoredVideoProbeSource } from "../../lib/boosterStoredVideoProbePolicy.ts";
import {
  resolveInrSendVideoDeliveryUrl,
  type InrSendVideoRegistryIdentity,
  type InrSendVideoStorageDependencies,
} from "../../lib/inrsend/publicationVideoStoragePolicy.ts";

const accountId = "8d7ac7ae-3a49-4660-8e44-79837cc563cc";
const privateBucket = "inrcy-pro-media";
const privatePath = `users/${accountId}/normalized/video/canonical.mp4`;

function dependencies(params: {
  registryRow?: InrSendVideoRegistryIdentity | null;
  signedUrl?: string | null;
  publicUrl?: string | null;
  calls?: string[];
} = {}): InrSendVideoStorageDependencies {
  const calls = params.calls || [];
  return {
    loadRegistryRow: async () => {
      calls.push("registry");
      return params.registryRow ?? null;
    },
    authorizeSource: (input) => {
      calls.push("authorize");
      return authorizeStoredVideoProbeSource(input);
    },
    createSignedUrl: async () => {
      calls.push("sign");
      return params.signedUrl ?? null;
    },
    getPublicUrl: () => {
      calls.push("public");
      return params.publicUrl ?? null;
    },
  };
}

function uploadedPrivateVideoRow(
  overrides: InrSendVideoRegistryIdentity = {},
): InrSendVideoRegistryIdentity {
  return {
    user_id: accountId,
    bucket_name: privateBucket,
    storage_path: privatePath,
    media_type: "video",
    upload_status: "uploaded",
    ...overrides,
  };
}

test("une URL externe sans référence Storage est conservée sans service role", async () => {
  const calls: string[] = [];
  const externalUrl = "https://cdn.example.test/video.mp4?version=7";
  const resolved = await resolveInrSendVideoDeliveryUrl(
    { accountId, currentUrl: externalUrl },
    dependencies({ calls }),
  );

  assert.deepEqual(resolved, {
    url: externalUrl,
    bucket: null,
    storagePath: null,
    refreshed: false,
  });
  assert.deepEqual(calls, []);
});

test("une vidéo privée possédée reçoit une nouvelle URL signée", async () => {
  const calls: string[] = [];
  const freshUrl = "https://project.supabase.co/storage/v1/object/sign/inrcy-pro-media/fresh.mp4?token=new";
  const expiredUrl = `https://project.supabase.co/storage/v1/object/sign/${privateBucket}/${privatePath}?token=expired`;
  const resolved = await resolveInrSendVideoDeliveryUrl(
    {
      accountId,
      storagePath: privatePath,
      currentUrl: expiredUrl,
    },
    dependencies({
      calls,
      registryRow: uploadedPrivateVideoRow(),
      signedUrl: freshUrl,
    }),
  );

  assert.deepEqual(calls, ["registry", "authorize", "sign"]);
  assert.deepEqual(resolved, {
    url: freshUrl,
    bucket: privateBucket,
    storagePath: privatePath,
    refreshed: true,
  });
});

test("une vidéo privée étrangère ou non uploadée est refusée avant signature", async () => {
  for (const registryRow of [
    uploadedPrivateVideoRow({ user_id: "other-account" }),
    uploadedPrivateVideoRow({ upload_status: "pending" }),
    null,
  ]) {
    const calls: string[] = [];
    await assert.rejects(
      resolveInrSendVideoDeliveryUrl(
        {
          accountId,
          bucket: privateBucket,
          storagePath: privatePath,
          currentUrl: "https://project.supabase.co/expired.mp4",
        },
        dependencies({ calls, registryRow, signedUrl: "https://should-not-be-used.test/video.mp4" }),
      ),
      /video_fallback_storage_reference_untrusted/,
    );
    assert.deepEqual(calls, ["registry", "authorize"]);
  }
});

test("la vidéo Booster historique reste limitée au préfixe du compte", async () => {
  const storagePath = `${accountId}/booster-videos/legacy.mp4`;
  const calls: string[] = [];
  const publicUrl = `https://project.supabase.co/storage/v1/object/public/booster/${storagePath}`;
  const resolved = await resolveInrSendVideoDeliveryUrl(
    { accountId, storagePath, currentUrl: "https://old.example.test/expired.mp4" },
    dependencies({ calls, publicUrl }),
  );

  assert.deepEqual(calls, ["registry", "authorize", "public"]);
  assert.deepEqual(resolved, {
    url: publicUrl,
    bucket: "booster",
    storagePath,
    refreshed: true,
  });

  const rejectedCalls: string[] = [];
  await assert.rejects(
    resolveInrSendVideoDeliveryUrl(
      {
        accountId,
        bucket: "booster",
        storagePath: "other-account/booster-videos/legacy.mp4",
        currentUrl: "https://old.example.test/expired.mp4",
      },
      dependencies({ calls: rejectedCalls, publicUrl }),
    ),
    /video_fallback_storage_reference_untrusted/,
  );
  assert.deepEqual(rejectedCalls, ["registry", "authorize"]);
});

test("le branchement serveur contrôle le registre avant toute signature", () => {
  const server = readFileSync(
    new URL("../../lib/inrsend/publicationVideoStorage.ts", import.meta.url),
    "utf8",
  );
  const actions = readFileSync(
    new URL("../../lib/inrsend/publicationChannelActions.ts", import.meta.url),
    "utf8",
  );

  for (const filter of [
    '.eq("user_id", params.accountId)',
    '.eq("bucket_name", params.bucket)',
    '.eq("storage_path", params.storagePath)',
    '.eq("media_type", "video")',
    '.eq("upload_status", "uploaded")',
  ]) {
    assert.ok(server.includes(filter), `filtre manquant: ${filter}`);
  }
  assert.match(server, /authorizeSource: authorizeStoredVideoProbeSource/);
  assert.match(server, /createSafeStorageSignedUrl/);
  assert.match(actions, /bucket: bucket \|\| null/);
  assert.match(actions, /await refreshInrSendPublicationVideoUrl\(/);
  assert.ok(
    actions.indexOf("await refreshInrSendPublicationVideoUrl(") <
      actions.indexOf("const replaceResult = await replaceChannelDelivery("),
  );
});
