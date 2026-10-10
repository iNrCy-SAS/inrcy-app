import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";

const resource = "projects/fixture-project/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001";
const operationName = `${resource}/operations/fixture-video`;
const videoBytes = Buffer.from("fixture-mp4-payload").toString("base64");

test("le SDK installé soumet un seul clip Vertex, consulte son opération et décode la vidéo inline", async () => {
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      method: request.method || "",
      path: request.url || "",
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith(":predictLongRunning")) {
      response.end(JSON.stringify({ name: operationName, done: false }));
    } else if (request.url?.endsWith(":fetchPredictOperation")) {
      response.end(JSON.stringify({
        name: operationName,
        done: true,
        response: { videos: [{ bytesBase64Encoded: videoBytes, mimeType: "video/mp4" }] },
      }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { message: "Unexpected fixture endpoint" } }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project: "fixture-project",
      location: "us-central1",
      // Dummy key prevents ADC/network access; every request stays on this fixture.
      apiKey: "fixture-only",
      httpOptions: { baseUrl: `http://127.0.0.1:${address.port}`, timeout: 2_000 },
    });
    const operation = await ai.models.generateVideos({
      model: "veo-3.1-fast-generate-001",
      source: { prompt: "An adult walks through a bright workshop." },
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: "9:16",
        resolution: "720p",
        generateAudio: true,
        personGeneration: "allow_adult",
        referenceImages: [{
          image: { imageBytes: "fixture-image", mimeType: "image/jpeg" },
          referenceType: "asset" as VideoGenerationReferenceType,
        }],
      },
    });
    assert.equal(operation.name, operationName);
    const completed = await ai.operations.getVideosOperation({
      operation,
      config: { httpOptions: { timeout: 2_000 } },
    });
    assert.equal(completed.done, true);
    assert.equal(completed.response?.generatedVideos?.[0]?.video?.videoBytes, videoBytes);
    assert.equal(completed.response?.generatedVideos?.[0]?.video?.mimeType, "video/mp4");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].path, `/v1beta1/${resource}:predictLongRunning`);
    assert.deepEqual(requests[0].body.parameters, {
      sampleCount: 1,
      durationSeconds: 8,
      aspectRatio: "9:16",
      resolution: "720p",
      generateAudio: true,
      personGeneration: "allow_adult",
    });
    assert.deepEqual(requests[0].body.instances, [{
      prompt: "An adult walks through a bright workshop.",
      referenceImages: [{
        image: { bytesBase64Encoded: "fixture-image", mimeType: "image/jpeg" },
        referenceType: "asset",
      }],
    }]);
    assert.equal(requests[1].method, "POST");
    assert.equal(requests[1].path, `/v1beta1/${resource}:fetchPredictOperation`);
    assert.deepEqual(requests[1].body, { operationName });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
