import assert from "node:assert/strict";
import test from "node:test";
import { createVeoVertexClientOptions, resolveVeoApiBackend, resolveVeoModelCandidates, resolveVeoVertexClientOptions, supportsVeoReferenceImages } from "../../lib/aiVideoReliability.ts";

test("Vertex migre les surcharges preview vers -001 sans réactiver les modèles retirés", () => {
  assert.deepEqual(resolveVeoModelCandidates({ backend: "vertex" }), ["veo-3.1-fast-generate-001", "veo-3.1-lite-generate-001"]);
  assert.deepEqual(resolveVeoModelCandidates({ backend: "vertex", primary: "veo-3.1-generate-preview", fallbacks: "veo-3.1-lite-generate-preview,veo-3.1-lite-generate-001,veo-3.0-fast-generate-001" }), ["veo-3.1-generate-001", "veo-3.1-lite-generate-001"]);
  assert.deepEqual(resolveVeoModelCandidates({ backend: "vertex", fallbacks: "" }), ["veo-3.1-fast-generate-001"]);
  assert.equal(supportsVeoReferenceImages("veo-3.1-fast-generate-001"), true);
  assert.equal(supportsVeoReferenceImages("veo-3.1-lite-generate-001"), false);
});

test("l'activation Vertex est explicite et une faute de configuration ne sélectionne pas un autre service", () => {
  assert.equal(resolveVeoApiBackend(undefined), "gemini");
  assert.equal(resolveVeoApiBackend("vertex"), "vertex");
  assert.throws(() => resolveVeoApiBackend("vertx"), /ai_video_veo_backend_invalid/);
});

test("Vertex exige projet et région supportés et ne réutilise pas la clé Gemini", () => {
  assert.deepEqual(resolveVeoVertexClientOptions({ AI_MEDIA_VEO_VERTEX_PROJECT: "fixture-project", GEMINI_API_KEY: "gemini-only" }), { vertexai: true, project: "fixture-project", location: "us-central1" });
  assert.throws(() => resolveVeoVertexClientOptions({}), /project_missing_or_invalid/);
  assert.throws(() => resolveVeoVertexClientOptions({ GOOGLE_CLOUD_PROJECT: "fixture-project", AI_MEDIA_VEO_VERTEX_LOCATION: "europe-west1" }), /location_unsupported/);
});

test("une configuration d'authentification invalide n'expose jamais ses données dans l'erreur", () => {
  for (const credentials of ["PRIVATE_CREDENTIAL_MARKER", "null", "[]", '"PRIVATE_CREDENTIAL_MARKER"']) {
    assert.throws(() => resolveVeoVertexClientOptions({ AI_MEDIA_VEO_VERTEX_PROJECT: "fixture-project", AI_MEDIA_VEO_VERTEX_CREDENTIALS_JSON: credentials }), (error: unknown) => error instanceof Error && error.message === "ai_video_veo_vertex_credentials_invalid");
  }
});

test("la fédération utilise des jetons Vercel renouvelables sans clé privée ni réseau à l'initialisation", async () => {
  let requests = 0;
  const options = await createVeoVertexClientOptions({
    AI_MEDIA_VEO_VERTEX_PROJECT: "fixture-project",
    AI_MEDIA_VEO_VERTEX_WIF_AUDIENCE: "//iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/fixture/providers/vercel",
    AI_MEDIA_VEO_VERTEX_SERVICE_ACCOUNT: "veo@fixture-project.iam.gserviceaccount.com",
  }, async () => `fixture-token-${++requests}`);
  assert.equal(options.apiKey, undefined);
  assert.equal(options.googleAuthOptions?.credentials, undefined);
  assert.equal(requests, 0);
  const client = options.googleAuthOptions?.authClient;
  assert.ok(client && "retrieveSubjectToken" in client);
  assert.equal(await client.retrieveSubjectToken(), "fixture-token-1");
  assert.equal(await client.retrieveSubjectToken(), "fixture-token-2");
});

test("une fédération incomplète ou un mélange avec des credentials échoue avant tout appel", async () => {
  for (const config of [
    { AI_MEDIA_VEO_VERTEX_SERVICE_ACCOUNT: "veo@fixture-project.iam.gserviceaccount.com" },
    { AI_MEDIA_VEO_VERTEX_WIF_AUDIENCE: "https://untrusted.example" },
    {
      AI_MEDIA_VEO_VERTEX_WIF_AUDIENCE: "//iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/fixture/providers/vercel",
      AI_MEDIA_VEO_VERTEX_SERVICE_ACCOUNT: "veo@fixture-project.iam.gserviceaccount.com",
      AI_MEDIA_VEO_VERTEX_CREDENTIALS_JSON: "{}",
    },
  ]) {
    await assert.rejects(createVeoVertexClientOptions({
      AI_MEDIA_VEO_VERTEX_PROJECT: "fixture-project", ...config,
    }), /ai_video_veo_vertex_federation_invalid/);
  }
});
