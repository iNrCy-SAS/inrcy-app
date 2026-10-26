import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { PreparedAuthEmail } from "./authMailPolicy";
import { TEMPORARY_PASSWORD_VALIDITY_DAYS, type TemporaryPasswordMetadata } from "./temporaryPasswordPolicy.ts";

const AAD = "inrcy-signup-welcome-v1:";
const GROUPS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#%+?-"];

export function createTemporarySignupCredential(now = new Date()) {
  const pool = GROUPS.join("");
  const characters = GROUPS.map((group) => group[randomInt(group.length)]);
  while (characters.length < 20) characters.push(pool[randomInt(pool.length)]);
  for (let index = characters.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  const metadata: TemporaryPasswordMetadata = {
    version: 1,
    welcome_id: randomUUID(),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + TEMPORARY_PASSWORD_VALIDITY_DAYS * 86_400_000).toISOString(),
  };
  return { password: characters.join(""), metadata };
}

function encryptionKey(secret: string) {
  if (secret.trim().length < 24) throw new Error("signup_welcome_encryption_unavailable");
  return createHash("sha256").update(AAD).update(secret).digest();
}

/** The retry outbox contains ciphertext only, bound to this one welcome email. */
export function sealSignupPassword(password: string, welcomeId: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(AAD + welcomeId));
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openSignupPassword(sealed: string, welcomeId: string, secret: string) {
  try {
    const packed = Buffer.from(sealed, "base64url");
    if (packed.length < 29 || packed.length > 256) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(AAD + welcomeId));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
  } catch { return null; }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function buildSignupWelcomeEmail(args: {
  welcomeId: string; userId: string; email: string; firstName: string; language: string;
  password: string; expiresAt: string; appOrigin: string;
}): PreparedAuthEmail {
  const loginUrl = new URL("/login", args.appOrigin);
  if (!((loginUrl.protocol === "https:") || (loginUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(loginUrl.hostname)))) {
    throw new Error("signup_welcome_origin_invalid");
  }
  loginUrl.searchParams.set("email", args.email);
  loginUrl.searchParams.set("lang", args.language);
  const french = args.language === "fr";
  const subject = french ? "Bienvenue chez iNrCy : vos accès sont prêts" : "Welcome to iNrCy: your account is ready";
  const greeting = `${french ? "Bonjour" : "Hello"}${args.firstName ? ` ${args.firstName}` : ""},`;
  const expiry = new Date(args.expiresAt).toLocaleDateString(french ? "fr-FR" : "en-GB", { timeZone: "Europe/Paris", dateStyle: "long" });
  const introduction = french
    ? "Bienvenue chez iNrCy ! Votre espace professionnel est prêt. Connectez-vous avec votre adresse e-mail et le mot de passe provisoire ci-dessous."
    : "Welcome to iNrCy! Your professional workspace is ready. Sign in with your email address and the temporary password below.";
  const passwordLabel = french ? "Mot de passe provisoire" : "Temporary password";
  const validity = french
    ? `Ce mot de passe est valable 30 jours, jusqu’au ${expiry}. Vous pouvez le modifier dès maintenant dans Mon compte, rubrique Compte. Après cette date, utilisez « Mot de passe oublié » pour en choisir un nouveau.`
    : `This password is valid for 30 days, until ${expiry}. You can change it at any time in My account, under Account. After that date, use “Forgot password” to choose a new one.`;
  const assistant = french
    ? "À votre arrivée, iNr’Assistant vous accompagne pour connecter vos canaux et bien démarrer."
    : "When you arrive, iNr’Assistant will help you connect your channels and get started.";
  const cta = french ? "Se connecter" : "Sign in";
  const privacy = french ? "Cet e-mail contient vos accès personnels. Ne le transférez pas." : "This email contains your personal sign-in details. Do not forward it.";
  const text = [greeting, introduction, `E-mail : ${args.email}`, `${passwordLabel} : ${args.password}`, validity, `${cta} : ${loginUrl}`, assistant, privacy, "L’équipe iNrCy"].join("\n\n");
  const html = `<!doctype html><html lang="${french ? "fr" : "en"}"><body style="margin:0;background:#071127;color:#f7f9ff;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#0d1833;border:1px solid #2b3e68;border-radius:18px"><tr><td style="padding:30px"><p style="font-size:24px;font-weight:bold;color:#55d7ff">iNrCy</p><h1 style="font-size:26px;line-height:34px;color:#fff">${french ? "Bienvenue chez iNrCy !" : "Welcome to iNrCy!"}</h1><p>${escapeHtml(greeting)}</p><p style="line-height:25px">${escapeHtml(introduction)}</p><p>E-mail : <strong>${escapeHtml(args.email)}</strong></p><div style="padding:18px;border:1px solid #384a75;border-radius:12px;background:#111c38"><p style="margin:0 0 12px">${passwordLabel}</p><code style="font-family:monospace;font-size:22px;letter-spacing:1px;color:#fff;word-break:break-all">${escapeHtml(args.password)}</code></div><p style="line-height:24px;color:#c1cfe8">${escapeHtml(validity)}</p><a href="${escapeHtml(loginUrl.toString())}" style="display:block;padding:17px 24px;margin:24px 0;border-radius:12px;background:#635bff;color:#fff;text-align:center;text-decoration:none;font-size:17px;font-weight:bold;line-height:22px">${cta}</a><p style="line-height:24px">${escapeHtml(assistant)}</p><p style="font-size:13px;line-height:20px;color:#afc0e2">${privacy}</p><p>L’équipe iNrCy</p></td></tr></table></td></tr></table></body></html>`;
  const deliveryHash = createHash("sha256").update(`signup-welcome-v1:${args.welcomeId}:${args.userId}`).digest("hex");
  return {
    deliveryKey: `v1:${deliveryHash}`, deliveryHash, providerIdempotencyKey: `inrcy-auth-${deliveryHash}`,
    hookId: `signup-welcome:${args.welcomeId}`, sequence: 0, userId: args.userId,
    recipient: args.email, action: "signup", subject, text, html,
  };
}
