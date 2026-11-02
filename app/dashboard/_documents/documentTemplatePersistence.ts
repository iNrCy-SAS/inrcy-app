/** A confirmed native write, never a model-provided snapshot. No automatic retry. */
export async function persistDocumentTemplate(options: {
  accountId: string; kind: "quote" | "invoice"; name: string; snapshot: unknown;
  isCurrent: () => boolean; fetcher?: typeof fetch; idempotencyKey?: string;
}) {
  if (!options.isCurrent()) return false;
  try {
    const response = await (options.fetcher ?? fetch)("/api/documents/templates", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": options.idempotencyKey ?? `native_template_${crypto.randomUUID()}` },
      body: JSON.stringify({ operation: "create", source: "form", accountId: options.accountId, kind: options.kind, name: options.name, snapshot: options.snapshot }),
    });
    const receipt = await response.json().catch(() => null);
    return options.isCurrent() && response.ok && receipt?.ok === true && receipt.status === "created" && receipt.kind === options.kind && receipt.name === options.name &&
      typeof receipt.id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(receipt.id) && receipt.documentCreated === false;
  } catch { return false; }
}
