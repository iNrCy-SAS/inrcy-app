import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import ts from "typescript";

import * as aiMemory from "../../lib/aiMemory.ts";
import type { AiMemoryReferenceDocument } from "../../lib/aiMemory.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const MEGABYTE = 1024 * 1024;

type Candidate = {
  id: string;
  path: string;
  size: number;
};

type LoadedRoute = {
  POST: (request: Request) => Promise<Response>;
};

type HarnessOptions = {
  analysisStatuses?: Array<"analysed" | "error">;
};

function storedDocument(index: number, size = 1_024): AiMemoryReferenceDocument {
  return {
    id: `stored-${index}`,
    name: `stored-${index}.pdf`,
    bucket: "inrcy-ai-documents",
    path: `users/${ACCOUNT_ID}/ai-memory-documents/stored-${index}.pdf`,
    mimeType: "application/pdf",
    size,
    status: "analysed",
    extractedText: `Document ${index}`,
    note: "",
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

function createHarness(
  initialDocuments: AiMemoryReferenceDocument[],
  options: HarnessOptions = {},
) {
  let memory = aiMemory.normalizeAiMemory(
    { referenceDocuments: initialDocuments },
    { includePremium: true },
  );
  const cleanedPaths: string[] = [];
  const warnings: unknown[][] = [];
  let analysisCalls = 0;
  let releaseAnalyses!: () => void;
  const bothAnalysesStarted = new Promise<void>((resolve) => {
    releaseAnalyses = resolve;
  });

  const analyseAiMemoryReferenceDocument = async (
    _supabase: unknown,
    ref: { name: string; path: string; type: string; size: number },
  ) => {
    const analysisIndex = analysisCalls;
    analysisCalls += 1;
    if (analysisCalls === 2) releaseAnalyses();
    await bothAnalysesStarted;
    const status = options.analysisStatuses?.[analysisIndex] || "analysed";
    if (status === "error") {
      return {
        name: ref.name,
        mimeType: ref.type,
        size: ref.size,
        status,
        text: "",
        note: "PDF sans texte extractible. OCR non disponible.",
      };
    }
    return {
      name: ref.name,
      mimeType: ref.type,
      size: ref.size,
      status: "analysed" as const,
      text: `Extrait ${ref.path}`,
    };
  };

  const query = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === "business_ai_memories") {
          return {
            data: { memory: structuredClone(memory), completion_score: 0 },
            error: null,
          };
        }
        if (table === "business_profiles") {
          return { data: { ai_preferred_engine: "mistral" }, error: null };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
    return chain;
  };

  const supabaseAdmin = {
    from: query,
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          cleanedPaths.push(...paths);
          return { error: null };
        },
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "inrcy_add_ai_memory_reference_document");
      const document = args.p_document as AiMemoryReferenceDocument;
      const existing = memory.referenceDocuments.find((item) => item.id === document.id);
      let resultStatus = "inserted";
      let resultDocument: AiMemoryReferenceDocument | null = document;

      if (existing) {
        resultStatus = "exists";
        resultDocument = existing;
      } else if (
        memory.referenceDocuments.some(
          (item) => item.bucket === document.bucket && item.path === document.path,
        )
      ) {
        resultStatus = "conflict_path";
        resultDocument = memory.referenceDocuments.find(
          (item) => item.bucket === document.bucket && item.path === document.path,
        ) || null;
      } else if (
        memory.referenceDocuments.length >= Number(args.p_max_items)
      ) {
        resultStatus = "limit_items";
        resultDocument = null;
      } else {
        const usedBytes = memory.referenceDocuments.reduce(
          (total, item) => total + Math.max(0, Number(item.size) || 0),
          0,
        );
        if (usedBytes + Number(document.size) > Number(args.p_max_total_bytes)) {
          resultStatus = "limit_bytes";
          resultDocument = null;
        } else {
          memory = aiMemory.normalizeAiMemory(
            {
              ...memory,
              referenceDocuments: [...memory.referenceDocuments, document],
            },
            { includePremium: true },
          );
        }
      }

      return {
        data: [{
          result_status: resultStatus,
          result_memory: structuredClone(memory),
          result_completion_score: 0,
          result_document: resultDocument,
        }],
        error: null,
      };
    },
  };

  const source = readFileSync(
    resolve(ROOT, "app/api/ai-memory/documents/route.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} as LoadedRoute };
  const modules = new Map<string, unknown>([
    ["node:crypto", { randomUUID }],
    ["next/server", {
      NextResponse: {
        json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
      },
    }],
    ["@/lib/aiAttachmentContext", { analyseAiMemoryReferenceDocument }],
    ["@/lib/aiEnginePreference", { normalizeAiPreferredEngine: () => "mistral" }],
    ["@/lib/aiMemory", aiMemory],
    ["@/lib/boosterGenerationContext", { invalidateBoosterGenerationContext: async () => undefined }],
    ["@/lib/mediaUploadPolicy", {
      buildDirectStorageResumableEndpoint: () => "",
      selectUniversalMediaUploadProtocol: () => "standard",
    }],
    ["@/lib/requireUser", {
      requireUser: async () => ({ activeUserId: ACCOUNT_ID, errorResponse: null }),
    }],
    ["@/lib/supabaseAdmin", { supabaseAdmin }],
  ]);

  new Function("module", "exports", "require", "console", compiled)(
    loaded,
    loaded.exports,
    (specifier: string) => {
      assert.ok(modules.has(specifier), `Unexpected route dependency: ${specifier}`);
      return modules.get(specifier);
    },
    {
      warn: (...args: unknown[]) => warnings.push(args),
      error: (...args: unknown[]) => warnings.push(args),
    },
  );

  const finalize = (candidate: Candidate) => loaded.exports.POST(new Request(
    "https://app.inrcy.test/api/ai-memory/documents",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "finalize",
        analysisConsent: true,
        id: candidate.id,
        name: `${candidate.id}.pdf`,
        mimeType: "application/pdf",
        storagePath: candidate.path,
        size: candidate.size,
      }),
    },
  ));

  return {
    finalize,
    getDocuments: () => memory.referenceDocuments,
    cleanedPaths,
    warnings,
  };
}

function candidate(id: string, size = 1_024): Candidate {
  const preparedId = id === "candidate-a"
    ? "10000000-0000-4000-8000-000000000001"
    : id === "candidate-b"
      ? "10000000-0000-4000-8000-000000000002"
      : id;
  return {
    id: preparedId,
    path: `users/${ACCOUNT_ID}/ai-memory-documents/${preparedId}-document.pdf`,
    size,
  };
}

test("deux finalisations concurrentes conservent les deux références quand les quotas le permettent", async () => {
  const harness = createHarness(
    Array.from({ length: 8 }, (_value, index) => storedDocument(index + 1)),
  );
  const first = candidate("candidate-a");
  const second = candidate("candidate-b");

  const responses = await Promise.all([
    harness.finalize(first),
    harness.finalize(second),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(harness.getDocuments().length, 10);
  assert.deepEqual(
    harness.getDocuments().slice(-2).map((document) => document.id).sort(),
    [first.id, second.id],
  );
  assert.deepEqual(harness.cleanedPaths, []);
});

test("la finalisation perdante sur la limite de fichiers répond 409 et nettoie seulement son blob", async () => {
  const harness = createHarness(
    Array.from({ length: 9 }, (_value, index) => storedDocument(index + 1)),
  );
  const candidates = [candidate("candidate-a"), candidate("candidate-b")];
  const responses = await Promise.all(candidates.map((item) => harness.finalize(item)));

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(harness.getDocuments().length, 10);
  const rejectedIndex = responses.findIndex((response) => response.status === 409);
  assert.deepEqual(harness.cleanedPaths, [candidates[rejectedIndex].path]);
});

test("la finalisation perdante sur 50 Mo répond 413 et ne sous-compte pas le total", async () => {
  const harness = createHarness([
    storedDocument(1, 20 * MEGABYTE),
    storedDocument(2, 15 * MEGABYTE),
  ]);
  const candidates = [
    candidate("candidate-a", 10 * MEGABYTE),
    candidate("candidate-b", 10 * MEGABYTE),
  ];
  const responses = await Promise.all(candidates.map((item) => harness.finalize(item)));

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 413]);
  assert.equal(
    harness.getDocuments().reduce((total, document) => total + Number(document.size || 0), 0),
    45 * MEGABYTE,
  );
  const rejectedIndex = responses.findIndex((response) => response.status === 413);
  assert.deepEqual(harness.cleanedPaths, [candidates[rejectedIndex].path]);
});

test("une analyse concurrente en échec ne supprime jamais le blob déjà référencé", async () => {
  const sharedCandidate = candidate("candidate-a");
  const harness = createHarness([], {
    analysisStatuses: ["analysed", "error"],
  });

  const responses = await Promise.all([
    harness.finalize(sharedCandidate),
    harness.finalize(sharedCandidate),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [200, 422]);
  assert.equal(harness.getDocuments().length, 1);
  assert.equal(harness.getDocuments()[0]?.id, sharedCandidate.id);
  assert.equal(harness.getDocuments()[0]?.path, sharedCandidate.path);
  assert.deepEqual(harness.cleanedPaths, []);
  assert.ok(
    harness.warnings.some((args) => String(args[0]).includes("analysis rejected; object retained")),
  );
});
