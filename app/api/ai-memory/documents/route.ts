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

async function persistDocuments(
  accountId: string,
  documents: AiMemoryReferenceDocument[],
  completionScore: number,
) {
  const current = await loadMemory(accountId);
  const memory = normalizeAiMemory(
    { ...current.memory, referenceDocuments: documents },
    { includePremium: true },
  );
  const { error } = await supabaseAdmin.from("business_ai_memories").upsert(
    {
      account_id: accountId,
      schema_version: 1,
      memory,
      completion_score: Number.isFinite(completionScore)
        ? completionScore
        : current.completionScore,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (error) throw error;
  await invalidateBoosterGenerationContext(accountId, "professional");
  return memory;
}

export async function POST(request: Request) {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = cleanText(body?.action, 30);

  try {
    const current = await loadMemory(activeUserId);

    if (action === "prepare") {
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
          { error: "Vous pouvez conserver jusqu’à 6 documents dans iNrADN." },
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
      if (
        !id ||
        !name ||
        !ownedPath(activeUserId, storagePath) ||
        !isAllowedFile(name, suppliedMimeType || mimeType) ||
        !Number.isFinite(declaredSize) ||
        declaredSize <= 0 ||
        declaredSize > AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES
      ) {
        return NextResponse.json({ error: "Document invalide ou non autorisé." }, { status: 400 });
      }
      if (current.memory.referenceDocuments.some((document) => document.id === id)) {
        return NextResponse.json({
          ok: true,
          memory: current.memory,
          documents: current.memory.referenceDocuments,
        });
      }
      if (current.memory.referenceDocuments.length >= AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS) {
        return NextResponse.json(
          { error: "Vous pouvez conserver jusqu’à 6 documents dans iNrADN." },
          { status: 409 },
        );
      }
      if (exceedsReferenceDocumentsQuota(current.memory.referenceDocuments, declaredSize)) {
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
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
      if (analysis.status === "ignored") {
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
        return NextResponse.json(
          { error: analysis.note || "Ce document n’a pas pu être analysé." },
          { status: 422 },
        );
      }

      const analysedSize = Math.max(0, Number(analysis.size) || declaredSize);
      if (exceedsReferenceDocumentsQuota(current.memory.referenceDocuments, analysedSize)) {
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
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
        status:
          analysis.status === "analysed"
            ? "analysed"
            : analysis.status === "error"
              ? "error"
              : "metadata_only",
        extractedText: cleanText(
          analysis.text,
          AI_MEMORY_REFERENCE_DOCUMENT_MAX_EXTRACT_CHARS,
        ),
        note: cleanText(analysis.note, 320),
        createdAt: new Date().toISOString(),
      };
      const documents = [...current.memory.referenceDocuments, document].slice(
        0,
        AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS,
      );
      const memory = await persistDocuments(
        activeUserId,
        documents,
        current.completionScore,
      );
      return NextResponse.json({ ok: true, document, memory, documents: memory.referenceDocuments });
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
    const documents = current.memory.referenceDocuments.filter((item) => item.id !== id);
    const memory = await persistDocuments(activeUserId, documents, current.completionScore);
    const { error: storageError } = await supabaseAdmin.storage
      .from(document.bucket)
      .remove([document.path]);
    if (storageError) {
      console.warn("[ai-memory/documents] orphan cleanup deferred", {
        accountId: activeUserId,
        path: document.path,
        message: storageError.message,
      });
    }
    return NextResponse.json({ ok: true, memory, documents: memory.referenceDocuments });
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
