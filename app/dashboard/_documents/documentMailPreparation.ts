type DocumentMailPreparation = {
  accountId: string;
  documentId: string;
  kind: "devis" | "facture";
  number: string;
  filename: string;
  recipient: string;
  clientName: string;
  subject: string;
  text: string;
  isCurrent: () => boolean;
  buildPdf: () => Promise<Blob | null>;
  upload: (key: string, pdf: Blob) => Promise<{ error: unknown }>;
  requestNavigation: (action: () => void) => Promise<boolean>;
  navigate: (path: string) => void;
};

/** Only renders, stores a PDF and opens the native composer. Never saves, finalizes or sends a document. */
export async function prepareDocumentMail(options: DocumentMailPreparation): Promise<
  "opened" | "stale" | "pdf_failed" | "upload_failed" | "navigation_cancelled" | "invalid_recipient"
> {
  if (!options.isCurrent()) return "stale";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.recipient.trim())) return "invalid_recipient";
  let pdf: Blob | null;
  try { pdf = await options.buildPdf(); } catch { return options.isCurrent() ? "pdf_failed" : "stale"; }
  if (!options.isCurrent()) return "stale";
  if (!pdf || pdf.type !== "application/pdf") return "pdf_failed";
  const filename = options.filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "document.pdf";
  const folder = options.kind === "devis" ? "devis" : "factures";
  const key = `${options.accountId}/${folder}/${crypto.randomUUID()}_${filename}`;
  try {
    const result = await options.upload(key, pdf);
    if (!options.isCurrent()) return "stale";
    if (result.error) return "upload_failed";
  } catch { return options.isCurrent() ? "upload_failed" : "stale"; }
  const params = new URLSearchParams({
    compose: "1", to: options.recipient.trim(), attachKey: key, attachName: filename,
    type: options.kind, docSaveId: options.documentId, docType: options.kind,
    docNumber: options.number, subject: options.subject, text: options.text,
  });
  if (options.clientName.trim()) params.set("clientName", options.clientName.trim());
  let opened = false;
  await options.requestNavigation(() => {
    // The unsaved-changes dialog may itself have waited while the account or preview changed.
    if (!options.isCurrent()) return;
    options.navigate(`/dashboard/mails?${params.toString()}`);
    opened = true;
  });
  return opened ? "opened" : options.isCurrent() ? "navigation_cancelled" : "stale";
}
