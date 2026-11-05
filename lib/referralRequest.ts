import { createHash } from "node:crypto";
export type ReferralRequest = { name: string; phone: string; email: string; from: string };
export function parseReferralRequest(value: unknown): ReferralRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Parrainage invalide.");
  const input = value as Record<string, unknown>, result: Record<string, string> = {};
  for (const key of ["name", "phone", "email", "from"]) {
    const maximum = key === "email" ? 254 : key === "phone" ? 40 : 160;
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > maximum || /[\r\n\x00-\x1f]/.test(input[key])) throw new Error("Merci de vérifier les coordonnées du parrainage.");
    result[key] = input[key].trim();
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email) || !/^[+\d() .-]{6,40}$/.test(result.phone) || result.phone.replace(/\D/g, "").length < 6) throw new Error("Merci de vérifier l’adresse email et le téléphone.");
  return result as ReferralRequest;
}
export function referralRequestKey(accountId: string, actorUserId: string, value: ReferralRequest) {
  return `assistant-referral:${createHash("sha256").update(JSON.stringify([accountId, actorUserId, value.name, value.phone, value.email.toLowerCase(), value.from])).digest("hex")}`;
}
