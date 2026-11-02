import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveInrSearchHistoricalMediaUrls,
  resolveInrSearchStorageMediaUrl,
  resolveInrSearchStorageMediaUrls,
  type InrSearchStorageMediaResolverDependencies,
  type InrSearchStorageObjectState,
} from "../../lib/inrSearchStorageMediaResolver.ts";

function resolverHarness(options: {
  states: Record<string, InrSearchStorageObjectState>;
  publicUrls?: Record<string, string | null>;
  signedUrls?: Record<string, string | null>;
}) {
  const calls = {
    probes: [] as string[],
    publicUrls: [] as string[],
    signedUrls: [] as string[],
  };
  const key = (bucket: string, storagePath: string) =>
    `${bucket}:${storagePath}`;
  const dependencies: InrSearchStorageMediaResolverDependencies = {
    async probeStorageObject(bucket, storagePath) {
      const candidateKey = key(bucket, storagePath);
      calls.probes.push(candidateKey);
      return options.states[candidateKey] || "unknown";
    },
    getPublicUrl(bucket, storagePath) {
      const candidateKey = key(bucket, storagePath);
      calls.publicUrls.push(candidateKey);
      return options.publicUrls?.[candidateKey] || null;
    },
    async signAuthorizedUrl(bucket, storagePath) {
      const candidateKey = key(bucket, storagePath);
      calls.signedUrls.push(candidateKey);
      return options.signedUrls?.[candidateKey] || null;
    },
  };
  return { calls, dependencies };
}

test("un média Booster existant utilise son URL publique sans signature", async () => {
  const candidateKey = "booster:publications/valid.jpg";
  const { calls, dependencies } = resolverHarness({
    states: { [candidateKey]: "exists" },
    publicUrls: { [candidateKey]: "https://cdn.example/valid.jpg" },
  });

  const urls = await resolveInrSearchStorageMediaUrls(
    [{ bucket: "booster", storagePath: "publications/valid.jpg" }],
    dependencies,
  );

  assert.deepEqual(urls, ["https://cdn.example/valid.jpg"]);
  assert.deepEqual(calls.probes, [candidateKey]);
  assert.deepEqual(calls.publicUrls, [candidateKey]);
  assert.deepEqual(calls.signedUrls, []);
});

test("un chemin Booster supprimé est filtré avant de produire une slide", async () => {
  const candidateKey = "booster:publications/deleted.jpg";
  const { calls, dependencies } = resolverHarness({
    states: { [candidateKey]: "missing" },
    publicUrls: { [candidateKey]: "https://cdn.example/deleted.jpg" },
    signedUrls: { [candidateKey]: "https://signed.example/deleted.jpg" },
  });

  const urls = await resolveInrSearchStorageMediaUrls(
    [{ bucket: "booster", storagePath: "publications/deleted.jpg" }],
    dependencies,
  );

  assert.deepEqual(urls, []);
  assert.deepEqual(calls.probes, [candidateKey]);
  assert.deepEqual(calls.publicUrls, []);
  assert.deepEqual(calls.signedUrls, []);
});

test("un chemin historique supprimé ne bloque pas le média Booster suivant", async () => {
  const deletedKey = "booster:publications/deleted.jpg";
  const validKey = "booster:publications/fallback.jpg";
  const { calls, dependencies } = resolverHarness({
    states: {
      [deletedKey]: "missing",
      [validKey]: "exists",
    },
    publicUrls: {
      [deletedKey]: "https://cdn.example/deleted.jpg",
      [validKey]: "https://cdn.example/fallback.jpg",
    },
  });

  const urls = await resolveInrSearchStorageMediaUrls(
    [
      { bucket: "booster", storagePath: "publications/deleted.jpg" },
      { bucket: "booster", storagePath: "publications/fallback.jpg" },
    ],
    dependencies,
  );

  assert.deepEqual(urls, ["https://cdn.example/fallback.jpg"]);
  assert.deepEqual(calls.probes, [deletedKey, validKey]);
  assert.deepEqual(calls.publicUrls, [validKey]);
  assert.deepEqual(calls.signedUrls, []);
});

test("un probe Booster indéterminé conserve le repli signé sûr", async () => {
  const candidateKey = "booster:publications/unknown.jpg";
  const { calls, dependencies } = resolverHarness({
    states: { [candidateKey]: "unknown" },
    publicUrls: { [candidateKey]: "https://cdn.example/unknown.jpg" },
    signedUrls: { [candidateKey]: "https://signed.example/unknown.jpg" },
  });

  const urls = await resolveInrSearchStorageMediaUrls(
    [{ bucket: "booster", storagePath: "publications/unknown.jpg" }],
    dependencies,
  );

  assert.deepEqual(urls, ["https://signed.example/unknown.jpg"]);
  assert.deepEqual(calls.probes, [candidateKey]);
  assert.deepEqual(calls.publicUrls, []);
  assert.deepEqual(calls.signedUrls, [candidateKey]);
});

test("une URL publique Booster invalide conserve le repli signé sûr", async () => {
  const candidateKey = "booster:publications/public-url-invalid.jpg";
  const { calls, dependencies } = resolverHarness({
    states: { [candidateKey]: "exists" },
    publicUrls: { [candidateKey]: null },
    signedUrls: {
      [candidateKey]: "https://signed.example/public-url-invalid.jpg",
    },
  });

  const urls = await resolveInrSearchStorageMediaUrls(
    [
      {
        bucket: "booster",
        storagePath: "publications/public-url-invalid.jpg",
      },
    ],
    dependencies,
  );

  assert.deepEqual(urls, [
    "https://signed.example/public-url-invalid.jpg",
  ]);
  assert.deepEqual(calls.probes, [candidateKey]);
  assert.deepEqual(calls.publicUrls, [candidateKey]);
  assert.deepEqual(calls.signedUrls, [candidateKey]);
});

const historicalScope = {
  supabaseUrl: "https://project.supabase.co",
  accountId: "published-account",
};

test("une vidéo manquante ne devient pas une URL publique et laisse essayer la suivante", async () => {
  const missing = "booster:published-account/deleted.mp4";
  const valid = "booster:published-account/valid.mp4";
  const { calls, dependencies } = resolverHarness({
    states: { [missing]: "missing", [valid]: "exists" },
    publicUrls: { [missing]: "https://cdn.example/deleted.mp4", [valid]: "https://cdn.example/valid.mp4" },
  });
  const url = await resolveInrSearchStorageMediaUrl([
    { bucket: "booster", storagePath: "published-account/deleted.mp4" },
    { bucket: "booster", storagePath: "published-account/valid.mp4" },
  ], dependencies);
  assert.equal(url, "https://cdn.example/valid.mp4");
  assert.deepEqual(calls.publicUrls, [valid]);
});

test("le repli historique ne réintroduit pas un objet Booster supprimé", async () => {
  const key = "booster:published-account/deleted.jpg";
  const { calls, dependencies } = resolverHarness({
    states: { [key]: "missing" },
    publicUrls: { [key]: "https://cdn.example/deleted.jpg" },
  });
  const urls = await resolveInrSearchHistoricalMediaUrls([
    `${historicalScope.supabaseUrl}/storage/v1/object/sign/booster/published-account/deleted.jpg?token=expired`,
  ], dependencies, historicalScope);
  assert.deepEqual(urls, []);
  assert.deepEqual(calls.publicUrls, []);
  assert.deepEqual(calls.signedUrls, []);
});

test("une ancienne signature Booster est remplacée par le média public vérifié", async () => {
  const key = "booster:published-account/valid.jpg";
  const { calls, dependencies } = resolverHarness({
    states: { [key]: "exists" },
    publicUrls: { [key]: "https://cdn.example/valid.jpg" },
  });
  assert.deepEqual(await resolveInrSearchHistoricalMediaUrls([
    `${historicalScope.supabaseUrl}/storage/v1/object/sign/booster/published-account/valid.jpg?token=expired`,
  ], dependencies, historicalScope), ["https://cdn.example/valid.jpg"]);
  assert.deepEqual(calls.probes, [key]);
  assert.deepEqual(calls.signedUrls, []);
});

test("un média privé publié est renouvelé et une signature impossible ne réutilise pas l'ancien jeton", async () => {
  const existing = "inrcy-pro-media:users/published-account/valid.jpg";
  const missing = "inrcy-pro-media:users/published-account/deleted.jpg";
  const { calls, dependencies } = resolverHarness({
    states: {},
    signedUrls: { [existing]: "https://signed.example/fresh.jpg" },
  });
  assert.deepEqual(await resolveInrSearchHistoricalMediaUrls([
    `${historicalScope.supabaseUrl}/storage/v1/object/sign/inrcy-pro-media/users/published-account/deleted.jpg?token=expired`,
    `${historicalScope.supabaseUrl}/storage/v1/render/image/sign/inrcy-pro-media/users/published-account/valid.jpg?token=expired`,
  ], dependencies, historicalScope), ["https://signed.example/fresh.jpg"]);
  assert.deepEqual(calls.signedUrls, [missing, existing]);
});

test("les URLs externes restent intactes sans être signées par notre projet", async () => {
  const { calls, dependencies } = resolverHarness({ states: {} });
  const external = "https://external.example/storage/v1/object/sign/booster/other/photo.jpg?token=external";
  assert.deepEqual(await resolveInrSearchHistoricalMediaUrls([
    external, "https://cdn.example/photo.jpg", external,
  ], dependencies, historicalScope), [external, "https://cdn.example/photo.jpg"]);
  assert.deepEqual(calls.probes, []);
  assert.deepEqual(calls.signedUrls, []);
});

test("le renouvellement historique ne peut pas signer un autre compte ou un bucket interne", async () => {
  const { calls, dependencies } = resolverHarness({ states: {} });
  const prefix = `${historicalScope.supabaseUrl}/storage/v1/object/sign/`;
  assert.deepEqual(await resolveInrSearchHistoricalMediaUrls([
    `${prefix}inrcy-pro-media/users/another-account/photo.jpg?token=old`,
    `${prefix}booster/another-account/photo.jpg?token=old`,
    `${prefix}inrcy-assistant-attachments/published-account/private.json?token=old`,
    `${prefix}inrcy-pro-media/users/published-account/%2e%2e%2fprivate.jpg?token=old`,
  ], dependencies, historicalScope), []);
  assert.deepEqual(calls.probes, []);
  assert.deepEqual(calls.signedUrls, []);
});
