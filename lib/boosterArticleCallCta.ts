import { dialCtaPhone, parseCtaPhoneNumbers } from "./ctaPhoneNumbers.ts";

/** Site articles keep one safe dial link per visible telephone number. */
export function parseBoosterArticleCallCtas(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(.+?)(?:\s*[:：]\s*|\s+[—–-]\s*|\s+)(\+?[\d][\d+\s()./;|,-]{6,110})$/u);
  if (!match) return [];

  return parseCtaPhoneNumbers(match[2]).map(phone => ({
    label: match[1].trim().slice(0, 120) || "Appeler",
    phone,
    href: `tel:${dialCtaPhone(phone)}`,
  }));
}

/** Legacy singular callers must not silently discard a second number. */
export function parseBoosterArticleCallCta(value: unknown) {
  const numbers = parseBoosterArticleCallCtas(value);
  return numbers.length === 1 ? numbers[0] : null;
}
