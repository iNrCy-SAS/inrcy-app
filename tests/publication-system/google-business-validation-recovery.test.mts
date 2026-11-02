import assert from "node:assert/strict";
import test from "node:test";
import { GoogleBusinessPostTransportError, postGoogleBusinessLocalPost } from "../../lib/googleBusinessPostTransport.ts";
import { isGoogleBusinessMediaProviderError } from "../../lib/googleBusinessMediaProbe.ts";

async function rejected(details: unknown[]) {
  let requests = 0;
  const error = await postGoogleBusinessLocalPost({
    endpoint: "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts",
    accessToken: "synthetic-token",
    payload: { summary: "Texte choisi", topicType: "STANDARD" },
    fetchImpl: async () => {
      requests++;
      return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Request contains an invalid argument.", details } }, { status: 400 });
    },
  }).then(() => null, (error: unknown) => error);
  assert.ok(error instanceof GoogleBusinessPostTransportError);
  assert.equal(requests, 1, "the transport never republishes by itself");
  assert.equal(error.outcomeUnknown, false);
  assert.equal(error.retryable, false);
  return error;
}

test("native GMB errorDetails preserve the media cause and reach the existing repair classifier", async () => {
  const error = await rejected([{
    "@type": "type.googleapis.com/google.mybusiness.v4.ValidationError",
    errorDetails: [{ code: 1000, field: "media[1].source_url", message: "Fetching image failed. ?access_token=private-token", ignored: "private-payload" }],
  }]);
  assert.deepEqual(error.fieldViolations, [{ code: 1000, field: "media[1].source_url", description: "Fetching image failed. ?access_token=[redacted]" }]);
  assert.equal(isGoogleBusinessMediaProviderError(error), true);
  assert.doesNotMatch(JSON.stringify(error), /private-token|private-payload|ignored/);
});

test("a native GMB summary rejection does not trigger media repair or a fabricated caption", async () => {
  const error = await rejected([{
    "@type": "type.googleapis.com/google.mybusiness.v4.ValidationError",
    errorDetails: [{ code: 2, field: "summary", message: "summary is required" }],
  }]);
  assert.equal(isGoogleBusinessMediaProviderError(error), false);
  assert.deepEqual(error.fieldViolations, [{ code: 2, field: "summary", description: "summary is required" }]);
});

test("generic Google field violations also identify a rejected source URL", async () => {
  const error = await rejected([{
    "@type": "type.googleapis.com/google.rpc.BadRequest",
    fieldViolations: [{ field: "media[0].source_url", description: "Invalid value" }],
  }]);
  assert.equal(isGoogleBusinessMediaProviderError(error), true);
  assert.equal(isGoogleBusinessMediaProviderError(new Error("Request contains an invalid argument.")), false);
});

test("native validation diagnostics remain bounded and discard unknown response data", async () => {
  const error = await rejected([{
    "@type": "type.googleapis.com/google.mybusiness.v4.ValidationError",
    errorDetails: Array.from({ length: 25 }, () => ({ field: "f".repeat(500), message: "m".repeat(1000), code: "invalid", submittedValue: "private-content" })),
  }]);
  assert.equal(error.fieldViolations.length, 20);
  assert.ok(error.fieldViolations.every(v => v.field.length === 300 && v.description.length === 800 && v.code === undefined));
  assert.doesNotMatch(JSON.stringify(error.details), /private-content|submittedValue/);
});
