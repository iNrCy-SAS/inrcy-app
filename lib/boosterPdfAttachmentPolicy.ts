export const BOOSTER_PDF_ACCEPT = "application/pdf,.pdf";
export const BOOSTER_PDF_MAX_BYTES = 8 * 1024 * 1024;
export const BOOSTER_PDF_MAX_TEXT_CHARS = 6_500;
export const BOOSTER_PDF_STORAGE_BUCKET = "inrbox_attachments";
export const BOOSTER_PDF_STORAGE_FOLDER = "booster-pdf-context";

export type BoosterPdfAttachmentRef = {
  bucket: string;
  path: string;
  name: string;
  type: string;
  size: number;
};

export class BoosterPdfAttachmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BoosterPdfAttachmentError";
    this.code = code;
  }
}

export type BoosterPdfAttachmentMetadata = {
  name?: unknown;
  type?: unknown;
  size?: unknown;
};

export type BoosterPdfAttachmentValidation =
  | { ok: true }
  | {
      ok: false;
      code:
        | "booster_pdf_missing"
        | "booster_pdf_invalid_type"
        | "booster_pdf_empty"
        | "booster_pdf_too_large";
      message: string;
    };

function formatMaxSize() {
  return `${Math.round(BOOSTER_PDF_MAX_BYTES / (1024 * 1024))} Mo`;
}

export function validateBoosterPdfAttachmentMetadata(
  value: BoosterPdfAttachmentMetadata | null | undefined,
): BoosterPdfAttachmentValidation {
  if (!value) {
    return {
      ok: false,
      code: "booster_pdf_missing",
      message: "Sélectionnez un fichier PDF.",
    };
  }

  const name = String(value.name || "").trim();
  const mimeType = String(value.type || "").trim().toLowerCase();
  const size = Number(value.size);
  const hasPdfName = /\.pdf$/i.test(name);
  const hasPdfMime =
    !mimeType ||
    mimeType === "application/pdf" ||
    mimeType === "application/x-pdf";

  if (!hasPdfName || !hasPdfMime) {
    return {
      ok: false,
      code: "booster_pdf_invalid_type",
      message: "Seuls les fichiers PDF sont acceptés.",
    };
  }

  if (!Number.isFinite(size) || size <= 0) {
    return {
      ok: false,
      code: "booster_pdf_empty",
      message: "Ce fichier PDF est vide ou illisible.",
    };
  }

  if (size > BOOSTER_PDF_MAX_BYTES) {
    return {
      ok: false,
      code: "booster_pdf_too_large",
      message: `Le PDF dépasse la taille maximale de ${formatMaxSize()}.`,
    };
  }

  return { ok: true };
}

export function hasBoosterPdfSignature(bytes: Uint8Array) {
  const headerLength = Math.min(bytes.byteLength, 1_024);
  for (let index = 0; index <= headerLength - 5; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}
