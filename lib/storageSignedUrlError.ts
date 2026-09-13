import { createHash } from "node:crypto";

type StorageErrorLike = {
  statusCode?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  error?: unknown;
};

function asStorageError(error: unknown): StorageErrorLike {
  return error && typeof error === "object" ? (error as StorageErrorLike) : {};
}

export function getStorageErrorStatus(error: unknown) {
  const candidate = asStorageError(error);
  for (const value of [candidate.status, candidate.statusCode]) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^\d{3}$/.test(value.trim())) {
      return Number(value.trim());
    }
  }
  return 0;
}

export function getStorageErrorCode(error: unknown) {
  const candidate = asStorageError(error);
  for (const value of [candidate.code, candidate.statusCode]) {
    const code = typeof value === "string" ? value.trim() : "";
    if (code && !/^\d{3}$/.test(code) && /^[a-z0-9_.:-]{1,80}$/i.test(code)) {
      return code;
    }
  }
  return null;
}

function getStorageErrorMessage(error: unknown) {
  const candidate = asStorageError(error);
  return [candidate.message, candidate.error]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function isMissingStorageObjectError(error: unknown) {
  const status = getStorageErrorStatus(error);
  const code = String(getStorageErrorCode(error) || "").toLowerCase();
  const message = getStorageErrorMessage(error);
  return (
    status === 404 ||
    code === "nosuchkey" ||
    code === "nosuchbucket" ||
    code === "not_found" ||
    message.includes("not found") ||
    message.includes("does not exist")
  );
}

export function isTransientStorageError(error: unknown) {
  const status = getStorageErrorStatus(error);
  const message = getStorageErrorMessage(error);
  return (
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("econnreset")
  );
}

export function isStorageClientError(error: unknown) {
  const status = getStorageErrorStatus(error);
  return status >= 400 && status < 500;
}

export function createStorageSignErrorDiagnostic(args: {
  error: unknown;
  bucket: string;
  path: string;
}) {
  const objectFingerprint = createHash("sha256")
    .update(`${args.bucket}\0${args.path}`, "utf8")
    .digest("hex")
    .slice(0, 20);

  return {
    status: getStorageErrorStatus(args.error) || null,
    code: getStorageErrorCode(args.error),
    object_fingerprint: objectFingerprint,
  };
}
