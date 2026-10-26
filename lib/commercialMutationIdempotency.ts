import "server-only";

import { createHash } from "node:crypto";

/** Keys identify one authenticated operation; they never select its account. */
export function commercialMutationId(accountId: string, key: string, kind: "contact" | "devis" | "facture"): string {
  if (!/^[a-f0-9-]{36}$/i.test(accountId) || !/^[a-zA-Z0-9_-]{16,180}$/.test(key)) throw new Error("Clé de sauvegarde invalide.");
  const chars = createHash("sha256").update(`inrcy-commercial:${kind}:${accountId}:${key}`).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 3) | 8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function commercialIdempotencyKey(request: Request): string | null {
  const key = request.headers.get("idempotency-key");
  if (key === null) return null;
  if (!/^[a-zA-Z0-9_-]{16,180}$/.test(key)) throw new Error("Clé de sauvegarde invalide.");
  return key;
}
