export type InrAssistantDocumentMailCommand = {
  command: "prepare_document_mail";
  selection: { kind: "quote" | "invoice"; id: string };
  revision: string;
  expectedUpdatedAt: string;
  recipient: string;
};

export type InrAssistantDocumentPrefill = {
  operation: "convert_quote" | "apply_template";
  kind: "quote" | "invoice";
  sourceId: string;
  expectedUpdatedAt: string;
};
export function parseInrAssistantDocumentPrefill(value: unknown): InrAssistantDocumentPrefill | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!["convert_quote", "apply_template"].includes(String(input.operation)) || !["quote", "invoice"].includes(String(input.kind)) ||
    input.operation === "convert_quote" && input.kind !== "invoice" || typeof input.sourceId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.sourceId) ||
    typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) return null;
  return { operation: input.operation as InrAssistantDocumentPrefill["operation"], kind: input.kind as InrAssistantDocumentPrefill["kind"], sourceId: input.sourceId, expectedUpdatedAt: input.expectedUpdatedAt };
}
export function getInrAssistantDocumentPrefillNavigation(value: unknown) {
  const prefill = parseInrAssistantDocumentPrefill(value);
  if (!prefill) return null;
  const params = new URLSearchParams({
    [prefill.operation === "convert_quote" ? "fromDevisSaveId" : "templateSaveId"]: prefill.sourceId,
    sourceVersion: prefill.expectedUpdatedAt, assistantPrefill: "1",
  });
  return { destination: prefill.kind === "quote" ? "quotes" : "invoices",
    href: `/dashboard/${prefill.kind === "quote" ? "devis" : "factures"}/new?${params}`,
    label: prefill.operation === "convert_quote" ? "Préremplir une facture depuis le devis" : "Appliquer le modèle au formulaire",
    documentPrefill: prefill,
  };
}
export function getInrAssistantDocumentPrefillRequest(kind: "quote" | "invoice", params: { get: (key: string) => string | null }) {
  if (params.get("assistantPrefill") !== "1" || params.get("saveId") || params.get("docSaveId")) return null;
  const quote = params.get("fromDevisSaveId"), template = params.get("templateSaveId");
  if (!!quote === !!template) return null;
  return parseInrAssistantDocumentPrefill({ operation: quote ? "convert_quote" : "apply_template", kind,
    sourceId: quote || template, expectedUpdatedAt: params.get("sourceVersion") });
}

export function parseInrAssistantDocumentMailCommand(value: unknown): InrAssistantDocumentMailCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const selection = input.selection && typeof input.selection === "object" ? input.selection as Record<string, unknown> : {};
  if (input.command !== "prepare_document_mail" || !["quote", "invoice"].includes(String(selection.kind)) ||
    typeof selection.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(selection.id) ||
    typeof input.revision !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.revision) ||
    typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) ||
    typeof input.recipient !== "string" || input.recipient.length > 254 || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(input.recipient)) return null;
  return { command: "prepare_document_mail", selection: { kind: selection.kind as "quote" | "invoice", id: selection.id },
    revision: input.revision, expectedUpdatedAt: input.expectedUpdatedAt, recipient: input.recipient };
}
