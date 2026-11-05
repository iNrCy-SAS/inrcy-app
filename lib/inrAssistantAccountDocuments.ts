export type InrAssistantAccountDocumentCommand =
  { command: "download_account_export"; selection: { kind: "account_document"; id: "account_export" } }
  | { command: "configure_cookie_consent"; selection: { kind: "account_document"; id: "cookie_preferences" }; analytics: boolean }
  | { command: "download_subscription_invoice"; selection: { kind: "account_document"; id: string }; invoiceId: string }
  | { command: "open_subscription_invoice_link"; selection: { kind: "account_document"; id: string }; invoiceId: string };
export function parseInrAssistantAccountDocumentCommand(value: unknown): InrAssistantAccountDocumentCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  if (selection?.kind !== "account_document") return null;
  if (row.command === "configure_cookie_consent" && selection.id === "cookie_preferences" && typeof row.analytics === "boolean") return { command: row.command, selection: { kind: "account_document", id: "cookie_preferences" }, analytics: row.analytics };
  if (row.command === "download_account_export" && selection.id === "account_export") return { command: row.command, selection: { kind: "account_document", id: "account_export" } };
  if ((row.command === "download_subscription_invoice" || row.command === "open_subscription_invoice_link") && typeof row.invoiceId === "string" && /^in_[a-zA-Z0-9]{1,120}$/.test(row.invoiceId) && selection.id === row.invoiceId) return { command: row.command, selection: { kind: "account_document", id: row.invoiceId }, invoiceId: row.invoiceId };
  return null;
}
/** Never fetch personal exports into an LLM or accept a model-supplied download URL. */
export async function downloadInrAssistantAccountDocument(command: InrAssistantAccountDocumentCommand, stillCurrent: () => boolean): Promise<boolean> {
  if (!stillCurrent()) return false;
  if (command.command === "configure_cookie_consent") {
    const { setCookieAnalyticsPreference } = await import("./cookieConsentPreferences.ts");
    return stillCurrent() && setCookieAnalyticsPreference(command.analytics);
  }
  if (command.command === "download_account_export") {
    const response = await fetch("/api/account/export", { cache: "no-store", credentials: "include" });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
    const blob = await response.blob(); if (!stillCurrent()) return false;
    const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = `inrcy-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); return true;
  }
  const response = await fetch("/api/billing/invoices", { cache: "no-store", credentials: "include" });
  if (!response.ok) return false;
  const data = await response.json() as { invoices?: Array<{ id?: string; invoicePdf?: string; hostedInvoiceUrl?: string }> }, invoice = data.invoices?.find(item => item.id === command.invoiceId);
  const nativeUrl = command.command === "open_subscription_invoice_link" ? invoice?.hostedInvoiceUrl : invoice?.invoicePdf;
  if (!nativeUrl || !stillCurrent()) return false;
  let url: URL; try { url = new URL(nativeUrl); } catch { return false; }
  if (url.protocol !== "https:" || !["pay.stripe.com", "invoice.stripe.com"].includes(url.hostname) || url.username || url.password || url.port) return false;
  const anchor = document.createElement("a"); anchor.href = url.toString(); anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.click(); return true;
}
