/** A call destination is one or two independently validated phone numbers.
 * Keep legacy profile strings readable without ever joining their digits. */
function compactDialPhone(raw: string): string {
  return raw.replace(/^00\s*/u, "+").replace(/^\+(\d{1,3})\s*\(0\)/u, "+$1").replace(/[^\d+]/g, "");
}

export function normalizeSingleCtaPhone(value: unknown): string {
  const raw = String(value ?? "").replace(/^tel:/i, "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 48 || !/^\+?[\d\s().-]+$/u.test(raw)) return "";
  const count = compactDialPhone(raw).replace(/\D/g, "").length;
  return count >= 8 && count <= 15 ? raw : "";
}

export function dialCtaPhone(value: unknown): string {
  const phone = normalizeSingleCtaPhone(value);
  if (!phone) return "";
  return compactDialPhone(phone);
}

export function parseCtaPhoneNumbers(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 120) return [];
  const raw = value.trim();
  if (!raw) return [];
  const parts = raw.split(/\s*(?:[\/;,|\n]|\b(?:ou|or)\b)\s*/iu);
  if (parts.length > 2 || parts.some(part => !normalizeSingleCtaPhone(part))) return [];
  const unique = new Map<string, string>();
  for (const part of parts) {
    const normalized = normalizeSingleCtaPhone(part);
    unique.set(dialCtaPhone(normalized), normalized);
  }
  return [...unique.values()];
}

export function normalizeCtaCallPhones(value: unknown): string {
  return parseCtaPhoneNumbers(value).join(" / ");
}
