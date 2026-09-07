function normalizeHttpUrl(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw) || /^[^\s]+\.[^\s]+/.test(raw)) {
    return `https://${raw}`;
  }
  return "";
}

export function normalizeBoosterWhatsAppPhone(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const explicitlyInternational = /^\s*(?:\+|00)/.test(raw);
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Les profils français contiennent souvent 06… ou +33 (0)6… .
  if (digits.startsWith("330") && digits.length === 12) {
    digits = `33${digits.slice(3)}`;
  } else if (!explicitlyInternational && /^0\d{9}$/.test(digits)) {
    digits = `33${digits.slice(1)}`;
  }

  return /^[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

export function buildBoosterWhatsAppUrl(phone: unknown) {
  const digits = normalizeBoosterWhatsAppPhone(phone);
  return digits ? `https://wa.me/${digits}` : "";
}

export function isBoosterWhatsAppUrl(input: unknown) {
  const url = normalizeHttpUrl(input);
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return (
      hostname === "wa.me" ||
      hostname === "api.whatsapp.com" ||
      hostname === "web.whatsapp.com"
    );
  } catch {
    return false;
  }
}

export function getBoosterWhatsAppPhoneFromUrl(input: unknown) {
  const url = normalizeHttpUrl(input);
  if (!url || !isBoosterWhatsAppUrl(url)) return "";
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const candidate =
      hostname === "wa.me"
        ? parsed.pathname.split("/").filter(Boolean)[0] || ""
        : parsed.searchParams.get("phone") || "";
    return normalizeBoosterWhatsAppPhone(candidate);
  } catch {
    return "";
  }
}
