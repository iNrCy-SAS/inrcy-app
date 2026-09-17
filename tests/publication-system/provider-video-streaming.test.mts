import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

type UnknownRecord = Record<string, unknown>;
type UploadYoutubeShort = (
  input: UnknownRecord,
  dependencies: {
    fetchImpl: typeof fetch;
    waitImpl?: (ms: number) => Promise<void>;
    chunkSizeBytes?: number;
    maxChunkRetries?: number;
  },
) => Promise<UnknownRecord>;
type LinkedinPublishVideo = (input: UnknownRecord) => Promise<UnknownRecord>;

const requireFromTest = createRequire(import.meta.url);

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function loadTypeScriptModule(relativePath: string) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleRecord: { exports: UnknownRecord } = { exports: {} };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/tsSafe") {
      return {
        asRecord: (value: unknown) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as UnknownRecord)
            : {},
        asString: (value: unknown) =>
          typeof value === "string" ? value : "",
      };
    }
    if (specifier === "@/lib/providerMediaFallbackPolicy") {
      return {
        getProviderCreateFailureSafety: () => ({
          safeTextFallback: false,
          requestMayHaveSucceeded: false,
        }),
      };
    }
    if (specifier === "@/lib/mediaRules") {
      return {
        INR_MEDIA_VIDEO_SOURCE_MAX_BYTES: 75_000_000,
        INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL: "75 Mo",
      };
    }
    return requireFromTest(specifier);
  };
  const execute = new Function("module", "exports", "require", output);
  execute(moduleRecord, moduleRecord.exports, localRequire);
  return moduleRecord.exports;
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function rangedSourceResponse(firstByte: number, lastByte: number, total: number) {
  return new Response(Uint8Array.of(1), {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(lastByte - firstByte + 1),
      "Content-Range": `bytes ${firstByte}-${lastByte}/${total}`,
    },
  });
}

function header(init: RequestInit | undefined, name: string) {
  return new Headers(init?.headers).get(name) || "";
}

function youtubeInput(videoUrl: string): UnknownRecord {
  return {
    accessToken: "youtube-token",
    videoUrl,
    title: "Publication test",
    description: "Test streaming",
    privacyStatus: "public",
    publicationType: "short",
  };
}

const youtubeSource = read("lib/youtubeShortsPublish.ts");
const linkedinSource = read("lib/linkedinPublish.ts");
const youtubeExports = loadTypeScriptModule("lib/youtubeShortsPublish.ts");
const linkedinExports = loadTypeScriptModule("lib/linkedinPublish.ts");
const uploadYoutubeShort =
  youtubeExports.uploadYoutubeShort as UploadYoutubeShort;
const linkedinPublishVideo =
  linkedinExports.linkedinPublishVideo as LinkedinPublishVideo;

test("YouTube streams a 75 MB source in bounded resumable ranges", async () => {
  const size = 75_000_000;
  const chunkSize = 16 * 1024 * 1024;
  const sourceUrl = "https://storage.test/youtube-75.mp4";
  const sessionUrl = "https://upload.youtube.test/session-75";
  const downloadedRanges: Array<[number, number]> = [];
  const uploadedRanges: Array<[number, number]> = [];
  const uploadedBodies: unknown[] = [];
  let initializedSize = "";

  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const method = init?.method || "GET";
    if (url === sourceUrl && method === "HEAD") {
      return new Response(null, {
        headers: {
          "Content-Length": String(size),
          "Content-Type": "video/mp4",
        },
      });
    }
    if (url === sourceUrl && method === "GET") {
      const match = header(init, "Range").match(/^bytes=(\d+)-(\d+)$/);
      assert.ok(match, "every source request must be an explicit byte range");
      const firstByte = Number(match[1]);
      const lastByte = Number(match[2]);
      if (firstByte !== 0 || lastByte !== 0) {
        downloadedRanges.push([firstByte, lastByte]);
      }
      return rangedSourceResponse(firstByte, lastByte, size);
    }
    if (url.includes("googleapis.com/upload/youtube") && method === "POST") {
      initializedSize = header(init, "X-Upload-Content-Length");
      return new Response(null, {
        status: 201,
        headers: { Location: sessionUrl },
      });
    }
    if (url === sessionUrl && method === "PUT") {
      const contentRange = header(init, "Content-Range");
      assert.doesNotMatch(contentRange, /^bytes \*\//);
      const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      assert.ok(match);
      const firstByte = Number(match[1]);
      const lastByte = Number(match[2]);
      assert.equal(Number(match[3]), size);
      assert.equal(
        header(init, "Content-Length"),
        String(lastByte - firstByte + 1),
      );
      assert.equal((init as RequestInit & { duplex?: string }).duplex, "half");
      uploadedBodies.push(init?.body);
      uploadedRanges.push([firstByte, lastByte]);
      if (lastByte < size - 1) {
        return new Response(null, {
          status: 308,
          headers: { Range: `bytes=0-${lastByte}` },
        });
      }
      return jsonResponse({
        id: "youtube-video-75",
        snippet: { title: "Publication test" },
        status: { privacyStatus: "public", uploadStatus: "uploaded" },
      });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const result = await uploadYoutubeShort(youtubeInput(sourceUrl), {
    fetchImpl,
    waitImpl: async () => {},
    chunkSizeBytes: chunkSize,
  });

  assert.equal(result.ok, true);
  assert.equal(result.videoId, "youtube-video-75");
  assert.equal(initializedSize, String(size));
  assert.equal(downloadedRanges.length, Math.ceil(size / chunkSize));
  assert.deepEqual(downloadedRanges, uploadedRanges);
  let expectedFirstByte = 0;
  for (const [firstByte, lastByte] of uploadedRanges) {
    assert.equal(firstByte, expectedFirstByte);
    assert.ok(lastByte - firstByte + 1 <= chunkSize);
    expectedFirstByte = lastByte + 1;
  }
  assert.equal(expectedFirstByte, size);
  assert.ok(
    uploadedBodies.every((body) => body instanceof ReadableStream),
    "each YouTube chunk must receive the source response stream directly",
  );
});

test("YouTube resumes from the server offset after network and 5xx failures", async () => {
  for (const failureMode of ["network", "5xx"] as const) {
    const size = 20 * 1024 * 1024;
    const acceptedBeforeFailure = 4 * 1024 * 1024;
    const sourceUrl = `https://storage.test/youtube-resume-${failureMode}.mp4`;
    const sessionUrl = `https://upload.youtube.test/session-${failureMode}`;
    const downloadedRanges: Array<[number, number]> = [];
    let dataUploadCount = 0;
    let statusQueryCount = 0;
    let waitCount = 0;

    const fetchImpl = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url === sourceUrl && method === "HEAD") {
        return new Response(null, {
          headers: {
            "Content-Length": String(size),
            "Content-Type": "video/mp4",
          },
        });
      }
      if (url === sourceUrl && method === "GET") {
        const match = header(init, "Range").match(/^bytes=(\d+)-(\d+)$/);
        assert.ok(match);
        const firstByte = Number(match[1]);
        const lastByte = Number(match[2]);
        if (lastByte !== 0) downloadedRanges.push([firstByte, lastByte]);
        return rangedSourceResponse(firstByte, lastByte, size);
      }
      if (url.includes("googleapis.com/upload/youtube") && method === "POST") {
        return new Response(null, {
          status: 201,
          headers: { Location: sessionUrl },
        });
      }
      if (url === sessionUrl && method === "PUT") {
        const contentRange = header(init, "Content-Range");
        if (contentRange === `bytes */${size}`) {
          statusQueryCount += 1;
          return new Response(null, {
            status: 308,
            headers: { Range: `bytes=0-${acceptedBeforeFailure - 1}` },
          });
        }
        const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        assert.ok(match);
        const lastByte = Number(match[2]);
        dataUploadCount += 1;
        if (dataUploadCount === 1) {
          if (failureMode === "network") throw new Error("socket reset");
          return jsonResponse({ error: { message: "temporary" } }, 503);
        }
        if (lastByte < size - 1) {
          return new Response(null, {
            status: 308,
            headers: { Range: `bytes=0-${lastByte}` },
          });
        }
        return jsonResponse({ id: `resumed-${failureMode}` });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const result = await uploadYoutubeShort(youtubeInput(sourceUrl), {
      fetchImpl,
      waitImpl: async () => {
        waitCount += 1;
      },
      chunkSizeBytes: 8 * 1024 * 1024,
      maxChunkRetries: 3,
    });

    assert.equal(result.ok, true, failureMode);
    assert.equal(statusQueryCount, 1, failureMode);
    assert.equal(waitCount, 1, failureMode);
    assert.deepEqual(
      downloadedRanges.map(([firstByte]) => firstByte),
      [0, acceptedBeforeFailure, 12 * 1024 * 1024],
      failureMode,
    );
  }
});

test("YouTube rejects oversized and incoherent ranged sources before upload", async () => {
  const oversized = 75_000_001;
  const oversizedUrl = "https://storage.test/youtube-oversized.mp4";
  let initialized = false;
  const oversizedResult = await uploadYoutubeShort(youtubeInput(oversizedUrl), {
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url === oversizedUrl && init?.method === "HEAD") {
        return new Response(null, {
          headers: {
            "Content-Length": String(oversized),
            "Content-Type": "video/mp4",
          },
        });
      }
      if (url === oversizedUrl) return rangedSourceResponse(0, 0, oversized);
      initialized = true;
      throw new Error("upload must not initialize");
    },
  });
  assert.equal(oversizedResult.ok, false);
  assert.match(String(oversizedResult.error), /75 Mo/);
  assert.equal(initialized, false);

  const size = 10 * 1024 * 1024;
  const sourceUrl = "https://storage.test/youtube-bad-range.mp4";
  const sessionUrl = "https://upload.youtube.test/session-bad-range";
  let dataUploadCalled = false;
  const badRangeResult = await uploadYoutubeShort(youtubeInput(sourceUrl), {
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url === sourceUrl && init?.method === "HEAD") {
        return new Response(null, {
          headers: {
            "Content-Length": String(size),
            "Content-Type": "video/mp4",
          },
        });
      }
      if (url === sourceUrl) {
        const range = header(init, "Range");
        if (range === "bytes=0-0") return rangedSourceResponse(0, 0, size);
        const match = range.match(/^bytes=(\d+)-(\d+)$/);
        assert.ok(match);
        return rangedSourceResponse(Number(match[1]) + 1, Number(match[2]), size);
      }
      if (url.includes("googleapis.com/upload/youtube")) {
        return new Response(null, {
          status: 201,
          headers: { Location: sessionUrl },
        });
      }
      if (url === sessionUrl) {
        dataUploadCalled = true;
        return jsonResponse({ id: "must-not-upload" });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
    maxChunkRetries: 0,
  });
  assert.equal(badRangeResult.ok, false);
  assert.match(String(badRangeResult.error), /plage/);
  assert.equal(dataUploadCalled, false);
});

test("YouTube guards the monoblock fallback when storage has no Range", async () => {
  const size = 41 * 1024 * 1024;
  const sourceUrl = "https://storage.test/youtube-no-range.mp4";
  const sessionUrl = "https://upload.youtube.test/session-no-range";
  let fullSourceGetCount = 0;
  const result = await uploadYoutubeShort(youtubeInput(sourceUrl), {
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url === sourceUrl && init?.method === "HEAD") {
        return new Response(null, {
          headers: {
            "Content-Length": String(size),
            "Content-Type": "video/mp4",
          },
        });
      }
      if (url === sourceUrl && header(init, "Range") === "bytes=0-0") {
        return new Response(Uint8Array.of(1), {
          headers: {
            "Content-Length": String(size),
            "Content-Type": "video/mp4",
          },
        });
      }
      if (url === sourceUrl) {
        fullSourceGetCount += 1;
        throw new Error("large monoblock download must not start");
      }
      if (url.includes("googleapis.com/upload/youtube")) {
        return new Response(null, {
          status: 201,
          headers: { Location: sessionUrl },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /ne permet pas la reprise/);
  assert.equal(fullSourceGetCount, 0);
});

test("LinkedIn derives 75 MB from storage and streams every instructed part", async () => {
  const size = 75_000_000;
  const split = size / 2;
  const sourceUrl = "https://storage.test/linkedin-75.mp4";
  const partUrls = [
    "https://upload.linkedin.test/part-1?signature=private-part-1",
    "https://upload.linkedin.test/part-2?signature=private-part-2",
  ];
  const downloadedRanges: string[] = [];
  const uploadedBodies: unknown[] = [];
  let initializedFileSize = 0;
  let finalizedPartIds: unknown = null;
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (url === sourceUrl && method === "HEAD") {
      return new Response(null, {
        headers: {
          "Content-Length": String(size),
          "Content-Type": "video/mp4",
        },
      });
    }
    if (url === sourceUrl && method === "GET") {
      const range = header(init, "Range");
      const match = range.match(/^bytes=(\d+)-(\d+)$/);
      assert.ok(match);
      downloadedRanges.push(range);
      return rangedSourceResponse(Number(match[1]), Number(match[2]), size);
    }
    if (url.includes("/rest/videos?action=initializeUpload")) {
      const payload = JSON.parse(String(init?.body)) as UnknownRecord;
      const request = payload.initializeUploadRequest as UnknownRecord;
      initializedFileSize = Number(request.fileSizeBytes);
      return jsonResponse({
        value: {
          video: "urn:li:video:test-75",
          uploadToken: "linkedin-upload-token",
          uploadInstructions: [
            { uploadUrl: partUrls[0], firstByte: 0, lastByte: split - 1 },
            { uploadUrl: partUrls[1], firstByte: split, lastByte: size - 1 },
          ],
        },
      });
    }
    if (partUrls.includes(url) && method === "PUT") {
      uploadedBodies.push(init?.body);
      const index = partUrls.indexOf(url);
      assert.equal(header(init, "Content-Length"), String(split));
      assert.equal((init as RequestInit & { duplex?: string }).duplex, "half");
      return new Response(null, {
        status: 201,
        headers: { ETag: `"part-etag-${index + 1}"` },
      });
    }
    if (url.includes("/rest/videos?action=finalizeUpload")) {
      const payload = JSON.parse(String(init?.body)) as UnknownRecord;
      const request = payload.finalizeUploadRequest as UnknownRecord;
      finalizedPartIds = request.uploadedPartIds;
      return jsonResponse({});
    }
    if (url.includes("/rest/videos/urn%3Ali%3Avideo%3Atest-75")) {
      return jsonResponse({ status: "AVAILABLE" });
    }
    if (url.includes("/rest/posts") && method === "POST") {
      return jsonResponse(
        { id: "urn:li:share:test-75" },
        201,
        { "x-restli-id": "urn:li:share:test-75" },
      );
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const result = await linkedinPublishVideo({
      accessToken: "linkedin-token",
      authorUrn: "urn:li:person:test",
      text: "Publication LinkedIn",
      videoUrl: sourceUrl,
      fileSizeBytes: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(initializedFileSize, size, "client size must never be trusted");
    assert.deepEqual(downloadedRanges, [
      `bytes=0-${split - 1}`,
      `bytes=${split}-${size - 1}`,
    ]);
    assert.ok(
      uploadedBodies.every((body) => body instanceof ReadableStream),
      "LinkedIn parts must receive source range streams directly",
    );
    assert.deepEqual(finalizedPartIds, ["part-etag-1", "part-etag-2"]);
    const serializedDiagnostics = JSON.stringify(result.diagnostics);
    assert.doesNotMatch(
      serializedDiagnostics,
      /private-part|upload\.linkedin\.test|storage\.test|uploadToken|uploadResponses|initJson|finalizeJson/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("LinkedIn rejects bad ranges, missing ETags, and videos over 75 MB", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const run = async (mode: "range" | "etag" | "oversized") => {
      const size =
        mode === "oversized" ? 75_000_001 : 10 * 1024 * 1024;
      const sourceUrl = `https://storage.test/linkedin-${mode}.mp4`;
      let initialized = false;
      let finalized = false;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (url === sourceUrl && method === "HEAD") {
          return new Response(null, {
            headers: {
              "Content-Length": String(size),
              "Content-Type": "video/mp4",
            },
          });
        }
        if (url.includes("/rest/videos?action=initializeUpload")) {
          initialized = true;
          return jsonResponse({
            value: {
              video: `urn:li:video:${mode}`,
              uploadToken: "token",
              uploadInstructions: [
                {
                  uploadUrl: `https://upload.linkedin.test/${mode}`,
                  firstByte: 0,
                  lastByte: size - 1,
                },
              ],
            },
          });
        }
        if (url === sourceUrl && method === "GET") {
          if (mode === "range") {
            return new Response(Uint8Array.of(1), {
              status: 200,
              headers: { "Content-Length": String(size) },
            });
          }
          return rangedSourceResponse(0, size - 1, size);
        }
        if (url.startsWith("https://upload.linkedin.test/")) {
          return new Response(null, { status: 201 });
        }
        if (url.includes("/rest/videos?action=finalizeUpload")) {
          finalized = true;
          return jsonResponse({});
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }) as typeof fetch;

      const result = await linkedinPublishVideo({
        accessToken: "linkedin-token",
        authorUrn: "urn:li:person:test",
        text: "Publication LinkedIn",
        videoUrl: sourceUrl,
      });
      assert.equal(result.ok, false, mode);
      assert.equal(finalized, false, mode);
      if (mode === "oversized") {
        assert.equal(initialized, false);
        assert.match(String(result.error), /75 Mo/);
      } else if (mode === "range") {
        assert.match(String(result.error), /segment/);
      } else {
        assert.match(String(result.error), /confirm.*segment/);
      }
    };

    await run("range");
    await run("etag");
    await run("oversized");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("provider video paths contain no whole-file buffering regression", () => {
  assert.doesNotMatch(youtubeSource, /\.arrayBuffer\(|\.blob\(|new Blob\(/);
  const linkedinVideoSection = linkedinSource.slice(
    linkedinSource.indexOf("type LinkedInVideoUploadInstruction"),
  );
  assert.doesNotMatch(
    linkedinVideoSection,
    /\.arrayBuffer\(|\.blob\(|new Blob\(|fetchVideoBlob/,
  );
  assert.match(youtubeSource, /status === 308/);
  assert.match(youtubeSource, /Content-Range": `bytes \*\/\$\{params\.total\}`/);
  assert.match(linkedinVideoSection, /sourceRange\.response\.body as unknown as BodyInit/);
});
