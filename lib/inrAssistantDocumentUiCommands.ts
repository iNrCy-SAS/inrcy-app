export type InrAssistantDocumentMailCommand = {
  command: "prepare_document_mail";
  selection: { kind: "quote" | "invoice"; id: string };
  revision: string;
  expectedUpdatedAt: string;
  recipient: string;
};

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
