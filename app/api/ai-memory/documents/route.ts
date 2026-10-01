import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { analyseAiMemoryReferenceDocument } from "@/lib/aiAttachmentContext";
import { normalizeAiPreferredEngine } from "@/lib/aiEnginePreference";
import {
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES,
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_EXTRACT_CHARS,
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS,
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES,
  normalizeAiMemory,
  type AiMemoryReferenceDocument,
} from "@/lib/aiMemory";
import { invalidateBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import {
  buildDirectStorageResumableEndpoint,
  selectUniversalMediaUploadProtocol,
} from "@/lib/mediaUploadPolicy";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 90;

// Les documents métier restent privés et séparés de la médiathèque publique.
// Cela évite que les restrictions image/vidéo du bucket média bloquent les PDF.
const BUCKET = "inrcy-ai-documents";
const LEGACY_BUCKET = "inrcy-pro-media";
const ALLOWED_DOCUMENT_BUCKETS = new Set([BUCKET, LEGACY_BUCKET]);
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "txt",
  "md",
  "csv",
  "json",
  "html",
  "htm",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
]);
const ALLOWED_MIME_PREFIXES = ["image/", "text/"];
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/json",
  "application/csv",
  "application/octet-stream",
]);
const CANONICAL_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop()?.replace(/[^a-z0-9]/g, "") || "";
}

function safeFileName(name: string) {
  const extension = fileExtension(name);
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
  return extension ? `${base}.${extension}` : base;
}

function isAllowedFile(name: string, mimeType: string) {
  const extensionAllowed = ALLOWED_EXTENSIONS.has(fileExtension(name));
  const mimeAllowed =
    ALLOWED_MIME_TYPES.has(mimeType.toLowerCase()) ||
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.toLowerCase().startsWith(prefix));
  return extensionAllowed && mimeAllowed;
}

function canonicalDocumentMimeType(name: string) {
  return CANONICAL_MIME_BY_EXTENSION[fileExtension(name)] || "application/octet-stream";
}

function ownedPath(accountId: string, path: string) {
  return (
    path.startsWith(`users/${accountId}/ai-memory-documents/`) &&
    !path.includes("..") &&
    !/[\u0000-\u001f]/.test(path)
  );
}

function referenceDocumentsSize(documents: AiMemoryReferenceDocument[]) {
  return documents.reduce(
    (total, document) => total + Math.max(0, Number(document.size) || 0),
    0,
  );
}

function exceedsReferenceDocumentsQuota(
  documents: AiMemoryReferenceDocument[],
  incomingSize: number,
) {
  return (
    referenceDocumentsSize(documents) + incomingSize >
    AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES
  );
}

async function loadMemory(accountId: string) {
  const { data, error } = await supabaseAdmin
    .from("business_ai_memories")
    .select("memory,completion_score")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  return {
    memory: normalizeAiMemory(data?.memory, { includePremium: true }),
    completionScore: Number(data?.completion_score || 0),
  };
}

type AtomicDocumentMutationStatus =
  | "inserted"
  | "exists"
  | "conflict_path"
  | "limit_items"
  | "limit_bytes"
  | "removed"
  | "not_found";

type AtomicDocumentMutation = {
  status: AtomicDocumentMutationStatus;
  memory: ReturnType<typeof normalizeAiMemory>;
  document: AiMemoryReferenceDocument | null;
};

function parseAtomicDocumentMutation(data: unknown): AtomicDocumentMutation {
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const status = cleanText(raw?.result_status, 40) as AtomicDocumentMutationStatus;
  if (
    !raw ||
    ![
      "inserted",
      "exists",
      "conflict_path",
      "limit_items",
      "limit_bytes",
      "removed",
      "not_found",
    ].includes(status)
  ) {
    throw new Error("Invalid atomic reference-document result");
  }

  const memory = normalizeAiMemory(raw.result_memory, { includePremium: true });
  const document = normalizeAiMemory(
    { referenceDocuments: raw.result_document ? [raw.result_document] : [] },
    { includePremium: true },
  ).referenceDocuments[0] || null;
  return { status, memory, document };
}

function isDefinitiveAtomicMutationFailure(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? cleanText((error as { code?: unknown }).code, 20).toUpperCase()
      : "";
  return /^[0-9A-Z]{5}$/.test(code) || /^PGRST[0-9]+$/.test(code);
}

async function addDocumentAtomically(
  accountId: string,
  document: AiMemoryReferenceDocument,
) {
  const { data, error } = await supabaseAdmin.rpc(
    "inrcy_add_ai_memory_reference_document",
    {
      p_account_id: accountId,
      p_document: document,
      p_max_items: AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS,
      p_max_total_bytes: AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES,
    },
  );
  if (error) throw error;
  return parseAtomicDocumentMutation(data);
}

async function removeDocumentAtomically(accountId: string, documentId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "inrcy_remove_ai_memory_reference_document",
    {
      p_account_id: accountId,
      p_document_id: documentId,
    },
  );
  if (error) throw error;
  return parseAtomicDocumentMutation(data);
}

async function cleanupUploadedDocument(
  accountId: string,
  storagePath: string,
  reason: string,
) {
  try {
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    if (error) throw error;
  } catch (error) {
    console.warn("[ai-memory/documents] uploaded object cleanup failed", {
      accountId,
      path: storagePath,
      reason,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request) {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = cleanText(body?.action, 30);

  try {
    if (action === "prepare") {
      const current = await loadMemory(activeUserId);
      const name = cleanText(body?.name, 180);
      const suppliedMimeType = cleanText(body?.mimeType, 140).toLowerCase();
      const mimeType = canonicalDocumentMimeType(name);
      const size = Number(body?.size || 0);
      if (!name || !isAllowedFile(name, suppliedMimeType || mimeType)) {
        return NextResponse.json(
          { error: "Format accepté : image, PDF, DOCX, TXT, Markdown, CSV, JSON ou HTML." },
          { status: 400 },
        );
      }
      if (!Number.isFinite(size) || size <= 0 || size > AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES) {
        return NextResponse.json(
          { error: "Le document ne doit pas dépasser 20 Mo." },
          { status: 413 },
        );
      }
      if (exceedsReferenceDocumentsQuota(current.memory.referenceDocuments, size)) {
        return NextResponse.json(
          { error: "L’espace Documents iNrADN est limité à 50 Mo au total." },
          { status: 413 },
        );
      }
      if (current.memory.referenceDocuments.length >= AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS) {
        return NextResponse.json(
          {
            error: `Vous pouvez conserver jusqu’à ${AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS} documents dans iNrADN.`,
          },
          { status: 409 },
        );
      }
      const id = randomUUID();
      const storagePath = `users/${activeUserId}/ai-memory-documents/${id}-${safeFileName(name)}`;
      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);
      if (error || !data?.token) throw error || new Error("Signed upload unavailable");
      const protocol = selectUniversalMediaUploadProtocol(size);
      const resumableEndpoint =
        protocol === "tus"
          ? buildDirectStorageResumableEndpoint(
              process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            )
          : "";

      return NextResponse.json({
        ok: true,
        id,
        bucket: BUCKET,
        mimeType,
        storagePath,
        token: data.token,
        protocol,
        resumableEndpoint,
      });
    }

    if (action === "finalize") {
      const current = await loadMemory(activeUserId);
      // Consent is explicit and mandatory: image bytes can be temporarily sent
      // to the configured AI engine for visual reading. Textual formats are
      // extracted locally, but use the same clear opt-in workflow.
      if (body?.analysisConsent !== true) {
        return NextResponse.json(
          {
            error:
              "Votre accord est requis pour analyser ce document et utiliser son extrait dans les outils IA iNrCy.",
            code: "AI_MEMORY_DOCUMENT_CONSENT_REQUIRED",
          },
          { status: 400 },
        );
      }

      const id = cleanText(body?.id, 120);
      const name = cleanText(body?.name, 180);
      const suppliedMimeType = cleanText(body?.mimeType, 140).toLowerCase();
      const mimeType = canonicalDocumentMimeType(name);
      const storagePath = cleanText(body?.storagePath, 1_000);
      const declaredSize = Number(body?.size || 0);
      const expectedPathPrefix = `users/${activeUserId}/ai-memory-documents/${id}-`;
      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
        !name ||
        !ownedPath(activeUserId, storagePath) ||
        !storagePath.startsWith(expectedPathPrefix) ||
        !isAllowedFile(name, suppliedMimeType || mimeType) ||
        !Number.isFinite(declaredSize) ||
        declaredSize <= 0 ||
        declaredSize > AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES
      ) {
        return NextResponse.json({ error: "Document invalide ou non autorisé." }, { status: 400 });
      }
      const existingDocument = current.memory.referenceDocuments.find(
        (document) => document.id === id,
      );
      if (existingDocument) {
        if (existingDocument.bucket !== BUCKET || existingDocument.path !== storagePath) {
          await cleanupUploadedDocument(activeUserId, storagePath, "document_id_conflict");
          return NextResponse.json(
            { error: "Cet identifiant de document est déjà utilisé." },
            { status: 409 },
          );
        }
        return NextResponse.json({
          ok: true,
          memory: current.memory,
          documents: current.memory.referenceDocuments,
        });
      }
      const pathOwner = current.memory.referenceDocuments.find(
        (document) => document.bucket === BUCKET && document.path === storagePath,
      );
      if (pathOwner) {
        // Never remove this object: another stored document still owns it.
        return NextResponse.json(
          { error: "Ce fichier est déjà associé à un autre document." },
          { status: 409 },
        );
      }
      if (current.memory.referenceDocuments.length >= AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS) {
        await cleanupUploadedDocument(activeUserId, storagePath, "item_limit_precheck");
        return NextResponse.json(
          {
            error: `Vous pouvez conserver jusqu’à ${AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS} documents dans iNrADN.`,
          },
          { status: 409 },
        );
      }
      if (exceedsReferenceDocumentsQuota(current.memory.referenceDocuments, declaredSize)) {
        await cleanupUploadedDocument(activeUserId, storagePath, "byte_limit_precheck");
        return NextResponse.json(
          { error: "L’espace Documents iNrADN est limité à 50 Mo au total." },
          { status: 413 },
        );
      }

      const { data: business } = await supabaseAdmin
        .from("business_profiles")
        .select("ai_preferred_engine")
        .eq("user_id", activeUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const analysis = await analyseAiMemoryReferenceDocument(
        supabaseAdmin,
        {
          bucket: BUCKET,
          path: storagePath,
          name,
          type: mimeType,
          size: declaredSize,
        },
        {
          userId: activeUserId,
          engine: normalizeAiPreferredEngine(business?.ai_preferred_engine),
          maxFileBytes: AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES,
          maxCharsPerFile: AI_MEMORY_REFERENCE_DOCUMENT_MAX_EXTRACT_CHARS,
        },
      );
      const isPdf = mimeType === "application/pdf" || fileExtension(name) === "pdf";
      if (
        analysis.status === "ignored" ||
        analysis.status === "error" ||
        (isPdf && analysis.status !== "analysed")
      ) {
        // Another finalize request for the same prepared object may already
        // have committed while this analysis was running. Never delete here:
        // keep the object available for an idempotent retry / deferred GC.
        console.warn("[ai-memory/documents] analysis rejected; object retained", {
          accountId: activeUserId,
          path: storagePath,
          status: analysis.status,
          note: analysis.note || "",
        });
        return NextResponse.json(
          { error: analysis.note || "Ce document n’a pas pu être analysé." },
          { status: 422 },
        );
      }

      const analysedSize = Math.max(0, Number(analysis.size) || declaredSize);
      if (exceedsReferenceDocumentsQuota(current.memory.referenceDocuments, analysedSize)) {
        await cleanupUploadedDocument(activeUserId, storagePath, "byte_limit_after_analysis");
        return NextResponse.json(
          { error: "L’espace Documents iNrADN est limité à 50 Mo au total." },
          { status: 413 },
        );
      }

      const document: AiMemoryReferenceDocument = {
        id,
        name: analysis.name || name,
        bucket: BUCKET,
        path: storagePath,
        mimeType: analysis.mimeType || mimeType,
        size: analysedSize,
        status: analysis.status === "analysed" ? "analysed" : "metadata_only",
        extractedText: cleanText(
          analysis.text,
          AI_MEMORY_REFERENCE_DOCUMENT_MAX_EXTRACT_CHARS,
        ),
        note: cleanText(analysis.note, 320),
        createdAt: new Date().toISOString(),
      };
      let mutation: AtomicDocumentMutation;
      try {
        mutation = await addDocumentAtomically(activeUserId, document);
      } catch (error) {
        if (isDefinitiveAtomicMutationFailure(error)) {
          await cleanupUploadedDocument(activeUserId, storagePath, "atomic_write_rejected");
        } else {
          // A timeout/network error may hide a committed transaction. Keeping
          // the object is safer than deleting a blob the database may reference;
          // the same id/path can be retried idempotently.
          console.warn("[ai-memory/documents] atomic write outcome uncertain", {
            accountId: activeUserId,
            path: storagePath,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      if (mutation.status === "limit_items") {
        await cleanupUploadedDocument(activeUserId, storagePath, "item_limit_atomic");
        return NextResponse.json(
          {
            error: `Vous pouvez conserver jusqu’à ${AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS} documents dans iNrADN.`,
          },
          { status: 409 },
        );
      }
      if (mutation.status === "limit_bytes") {
        await cleanupUploadedDocument(activeUserId, storagePath, "byte_limit_atomic");
        return NextResponse.json(
          { error: "L’espace Documents iNrADN est limité à 50 Mo au total." },
          { status: 413 },
        );
      }
      if (mutation.status === "conflict_path") {
        // The candidate path is already referenced. Cleaning it here would
        // break the existing document, so the object must remain untouched.
        return NextResponse.json(
          { error: "Ce fichier est déjà associé à un autre document." },
          { status: 409 },
        );
      }
      if (mutation.status !== "inserted" && mutation.status !== "exists") {
        throw new Error(`Unexpected atomic document status: ${mutation.status}`);
      }

      const persistedDocument =
        mutation.document ||
        mutation.memory.referenceDocuments.find((item) => item.id === document.id) ||
        null;
      if (!persistedDocument) {
        throw new Error("Atomic document write returned no document");
      }
      if (
        persistedDocument.id !== document.id ||
        persistedDocument.bucket !== BUCKET ||
        persistedDocument.path !== storagePath
      ) {
        await cleanupUploadedDocument(activeUserId, storagePath, "document_id_conflict_atomic");
        return NextResponse.json(
          { error: "Cet identifiant de document est déjà utilisé." },
          { status: 409 },
        );
      }

      await invalidateBoosterGenerationContext(activeUserId, "professional");
      return NextResponse.json({
        ok: true,
        document: persistedDocument,
        memory: mutation.memory,
        documents: mutation.memory.referenceDocuments,
      });
    }

    return NextResponse.json({ error: "Action de document inconnue." }, { status: 400 });
  } catch (error) {
    console.error("[ai-memory/documents] upload failed", {
      accountId: activeUserId,
      action,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Le document n’a pas pu être enregistré. Réessayez dans un instant." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = cleanText(body?.id, 120);
  if (!id) return NextResponse.json({ error: "Document introuvable." }, { status: 400 });

  try {
    const current = await loadMemory(activeUserId);
    const document = current.memory.referenceDocuments.find((item) => item.id === id);
    if (
      !document ||
      !ALLOWED_DOCUMENT_BUCKETS.has(document.bucket) ||
      !ownedPath(activeUserId, document.path)
    ) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }
    const mutation = await removeDocumentAtomically(activeUserId, id);
    if (mutation.status === "not_found") {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }
    if (mutation.status !== "removed") {
      throw new Error(`Unexpected atomic document status: ${mutation.status}`);
    }
    const removedDocument = mutation.document || document;
    if (
      !ALLOWED_DOCUMENT_BUCKETS.has(removedDocument.bucket) ||
      !ownedPath(activeUserId, removedDocument.path)
    ) {
      throw new Error("Atomic document deletion returned an invalid storage reference");
    }
    const { error: storageError } = await supabaseAdmin.storage
      .from(removedDocument.bucket)
      .remove([removedDocument.path]);
    if (storageError) {
      console.warn("[ai-memory/documents] orphan cleanup deferred", {
        accountId: activeUserId,
        path: removedDocument.path,
        message: storageError.message,
      });
    }
    await invalidateBoosterGenerationContext(activeUserId, "professional");
    return NextResponse.json({
      ok: true,
      memory: mutation.memory,
      documents: mutation.memory.referenceDocuments,
    });
  } catch (error) {
    console.error("[ai-memory/documents] delete failed", {
      accountId: activeUserId,
      id,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Le document n’a pas pu être supprimé. Réessayez." },
      { status: 500 },
    );
  }
}
