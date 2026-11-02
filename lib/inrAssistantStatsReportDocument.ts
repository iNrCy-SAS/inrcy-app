/** Only a stored PDF belonging to the active account may become a download. */
export function ownedInrAssistantStatsReportDocument(value: unknown, accountId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>, path = document.storagePath || document.storage_path || document.path;
  if (document.bucket !== "inr-agent-reports" || typeof path !== "string" || path.length > 1000 || !path.startsWith(`${accountId}/stats/`) || path.includes("..") || /[\\%?#\u0000-\u001f]/.test(path) || !/\.pdf$/i.test(path)) return null;
  const filename = typeof document.filename === "string" ? document.filename.replace(/[\r\n\\/"\u0000-\u001f]/g, "").slice(0, 180) : "";
  return { bucket: "inr-agent-reports", storagePath: path, filename: filename && /\.pdf$/i.test(filename) ? filename : "bilan-inrstats.pdf" };
}
