/** Site articles store their CTA as display text, so recover a safe tel: target. */
export function parseBoosterArticleCallCta(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(.+?)(?:\s*[:：]\s*|\s+[—–-]\s*|\s+)(\+?[\d][\d\s()./-]{6,40})$/u);
  if (!match) return null;

  const phone = match[2].trim();
  const dialPhone = phone
    .replace(/^\+(\d{1,3})\s*\(0\)/u, "+$1")
    .replace(/[^\d+]/g, "")
    .replace(/(?!^)\+/g, "");
  const digitCount = dialPhone.replace(/\D/g, "").length;
  if (digitCount < 8 || digitCount > 15) return null;

  return {
    label: match[1].trim().slice(0, 120) || "Appeler",
    phone,
    href: `tel:${dialPhone}`,
  };
}
