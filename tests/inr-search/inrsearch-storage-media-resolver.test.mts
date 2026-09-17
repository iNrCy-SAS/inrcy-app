import assert from "node:assert/strict";
import test from "node:test";

import {
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
    async createSignedUrl(bucket, storagePath) {
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
