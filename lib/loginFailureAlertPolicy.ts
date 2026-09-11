import { createHmac } from "node:crypto";

export const LOGIN_FAILURE_CATEGORIES = [
  "invalidCredentials",
  "emailUnconfirmed",
  "linkUnavailable",
  "network",
  "storage",
  "service",
  "technical",
] as const;

export type LoginFailureCategory = (typeof LOGIN_FAILURE_CATEGORIES)[number];

export type LoginFailureSignal =
  | { kind: "success" }
  | {
      kind: "failure";
      email: string;
      errorCode: string | null;
      errorStatus: number | null;
      category: LoginFailureCategory;
    };

export type LoginIdentityProfile = {
  user_id?: unknown;
  admin_email?: unknown;
  contact_email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  company_legal_name?: unknown;
  phone?: unknown;
};

export type LoginIdentitySubscription = {
  user_id?: unknown;
  contact_email?: unknown;
};

export type LoginIdentityResolution =
  | { status: "unknown" }
  | { status: "ambiguous"; candidateCount: number }
  | {
      status: "matched";
      userId: string;
      sources: string[];
      profile: LoginIdentityProfile | null;
    };

export type LoginFailureMailInput = {
  category: LoginFailureCategory;
  errorCode: string | null;
  errorStatus: number | null;
  failureCount: number;
  occurredAt: string;
  userId: string;
  canonicalEmail: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  createdAt?: string | null;
  lastSignInAt?: string | null;
  emailConfirmedAt?: string | null;
  matchSources?: string[];
};

const CATEGORY_SET = new Set<string>(LOGIN_FAILURE_CATEGORIES);
const FAILURE_KEYS = [
  "category",
  "email",
  "error_code",
  "error_status",
  "kind",
] as const;
const SUCCESS_KEYS = ["kind"] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function normalizeLoginEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isValidLoginEmail(value: string) {
  if (!value || value.length > 254 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  const separator = value.lastIndexOf("@");
  return separator > 0 && separator < value.length - 1 && !value.includes("..") && !value.endsWith(".");
}

function parseErrorCode(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const code = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(code)) return undefined;
  return code;
}

function parseErrorStatus(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) {
    return undefined;
  }
  return value;
}

function categoryFromStableCode(
  code: string | null,
  fallback: LoginFailureCategory,
): LoginFailureCategory {
  if (code === "invalid_credentials") return "invalidCredentials";
  if (code === "email_not_confirmed") return "emailUnconfirmed";
  return fallback;
}

export function parseLoginFailureSignal(value: unknown): LoginFailureSignal | null {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return null;

  if (value.kind === "success") {
    return hasExactKeys(value, SUCCESS_KEYS) ? { kind: "success" } : null;
  }

  if (value.kind !== "failure" || !hasExactKeys(value, FAILURE_KEYS)) return null;

  const email = normalizeLoginEmail(value.email);
  const category = String(value.category || "");
  const errorCode = parseErrorCode(value.error_code);
  const errorStatus = parseErrorStatus(value.error_status);
  if (
    !isValidLoginEmail(email) ||
    !CATEGORY_SET.has(category) ||
    errorCode === undefined ||
    errorStatus === undefined
  ) {
    return null;
  }

  return {
    kind: "failure",
    email,
    errorCode,
    errorStatus,
    category: categoryFromStableCode(errorCode, category as LoginFailureCategory),
  };
}

export function getLoginFailureThreshold(category: LoginFailureCategory) {
  if (category === "emailUnconfirmed") return 1;
  if (category === "invalidCredentials") return 3;
  return 2;
}

export function createLoginTelemetryFingerprint(value: string, secret: string) {
  return createHmac("sha256", secret)
    .update(String(value || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function exactEmail(value: unknown, expected: string) {
  return normalizeLoginEmail(value) === expected;
}

/**
 * Merge server-fetched identity rows, then fail closed unless one and only one
 * iNrCy user owns the normalized address. Rows are filtered again in memory so
 * a provider-side case-insensitive lookup can never turn SQL LIKE wildcards
 * into an identity match.
 */
export function resolveUniqueLoginIdentity(input: {
  email: string;
  profilesByAdminEmail: LoginIdentityProfile[];
  profilesByContactEmail: LoginIdentityProfile[];
  subscriptionsByContactEmail: LoginIdentitySubscription[];
}): LoginIdentityResolution {
  const email = normalizeLoginEmail(input.email);
  const candidates = new Map<
    string,
    { sources: Set<string>; profile: LoginIdentityProfile | null }
  >();

  const add = (
    row: LoginIdentityProfile | LoginIdentitySubscription,
    field: "admin_email" | "contact_email",
    source: string,
  ) => {
    const identityRow = row as unknown as Record<string, unknown>;
    if (!exactEmail(identityRow[field], email)) return;
    const userId = cleanText(row.user_id, 100);
    if (!userId) return;
    const current = candidates.get(userId) || { sources: new Set<string>(), profile: null };
    current.sources.add(source);
    if ("first_name" in row || "company_legal_name" in row || "admin_email" in row) {
      current.profile = row as LoginIdentityProfile;
    }
    candidates.set(userId, current);
  };

  for (const row of input.profilesByAdminEmail) {
    add(row, "admin_email", "profiles.admin_email");
  }
  for (const row of input.profilesByContactEmail) {
    add(row, "contact_email", "profiles.contact_email");
  }
  for (const row of input.subscriptionsByContactEmail) {
    add(row, "contact_email", "subscriptions.contact_email");
  }

  if (candidates.size === 0) return { status: "unknown" };
  if (candidates.size !== 1) {
    return { status: "ambiguous", candidateCount: candidates.size };
  }

  const [userId, candidate] = candidates.entries().next().value as [
    string,
    { sources: Set<string>; profile: LoginIdentityProfile | null },
  ];
  return {
    status: "matched",
    userId,
    sources: [...candidate.sources].sort(),
    profile: candidate.profile,
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value: unknown) {
  return cleanText(value, 320) || "Non renseigné";
}

function formatParisDate(value: string | null | undefined) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
}

function categoryPresentation(category: LoginFailureCategory) {
  switch (category) {
    case "invalidCredentials":
      return {
        label: "Connexions refusées à répétition",
        action:
          "Vérifier que le client utilise bien l’e-mail du compte, puis lui proposer la procédure « Mot de passe oublié ». Ne pas supprimer son compte.",
      };
    case "emailUnconfirmed":
      return {
        label: "Adresse e-mail non confirmée",
        action:
          "Vérifier l’état de confirmation dans Supabase et accompagner le client pour terminer la validation de son adresse.",
      };
    case "network":
    case "service":
      return {
        label: "Incident technique pendant la connexion",
        action:
          "Vérifier la disponibilité de Supabase et de l’application, puis contacter le client si l’incident persiste.",
      };
    case "storage":
      return {
        label: "Session navigateur non enregistrée",
        action:
          "Accompagner le client pour autoriser les cookies et relancer une connexion propre depuis son navigateur.",
      };
    case "linkUnavailable":
      return {
        label: "Lien d’authentification inutilisable",
        action:
          "Vérifier le parcours d’invitation ou de récupération et renvoyer un lien uniquement après contrôle du compte.",
      };
    default:
      return {
        label: "Erreur de connexion répétée",
        action:
          "Contrôler le compte dans Supabase et contacter le client si l’erreur persiste.",
      };
  }
}

function mailRow(label: string, value: string, emphasis = false) {
  return `<tr><td style="padding:8px 12px 8px 0;color:#64748b;vertical-align:top">${escapeHtml(label)}</td><td style="padding:8px 0;color:#0f172a;vertical-align:top;overflow-wrap:anywhere;${emphasis ? "font-weight:700" : ""}">${escapeHtml(value)}</td></tr>`;
}

export function buildLoginFailureAlertMail(input: LoginFailureMailInput) {
  const presentation = categoryPresentation(input.category);
  const canonicalEmail = normalizeLoginEmail(input.canonicalEmail);
  const fullName = [cleanText(input.firstName, 100), cleanText(input.lastName, 100)]
    .filter(Boolean)
    .join(" ");
  const companyName = cleanText(input.companyName, 180);
  const identity = companyName || fullName || canonicalEmail || input.userId.slice(0, 8);
  const neverSignedIn = !input.lastSignInAt;
  const subject = cleanText(`iNrCy — ${presentation.label} — ${identity}`, 150);
  const rows: Array<[string, string, boolean?]> = [
    ["Société", display(companyName), true],
    ["Contact", display(fullName), true],
    ["E-mail du compte", display(canonicalEmail), true],
    ["Téléphone", display(input.phone)],
    ["User ID", cleanText(input.userId, 100)],
    ["Nombre d’échecs", String(Math.max(1, Math.floor(input.failureCount)))],
    ["Compte créé", formatParisDate(input.createdAt)],
    ["Dernière connexion réussie", formatParisDate(input.lastSignInAt)],
    ["E-mail confirmé", input.emailConfirmedAt ? "Oui" : "Non"],
    ["Catégorie", input.category],
    ["Code Supabase", input.errorCode || "Non fourni"],
    ["Statut HTTP", input.errorStatus == null ? "Non fourni" : String(input.errorStatus)],
    ["Correspondance interne", (input.matchSources || []).join(", ") || "Non renseignée"],
    ["Dernier essai", formatParisDate(input.occurredAt)],
  ];

  const text = [
    presentation.label,
    "",
    neverSignedIn
      ? "Ce compte n’a encore aucune connexion réussie enregistrée. Une prise de contact rapide est recommandée."
      : "Ce compte a déjà réussi à se connecter auparavant. Ces essais peuvent être une difficulté client ou une tentative non autorisée.",
    "",
    ...rows.map(([label, value]) => `${label} : ${value}`),
    "",
    "Action recommandée",
    presentation.action,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;padding:24px">
      <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:18px;padding:26px;border:1px solid #e5e7eb">
        <div style="display:inline-block;padding:7px 11px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:800;text-transform:uppercase">Alerte connexion iNrCy</div>
        <h1 style="margin:16px 0 10px;font-size:22px;color:#0f172a">${escapeHtml(presentation.label)}</h1>
        <p style="margin:0 0 18px;color:#475569;line-height:1.55">${escapeHtml(
          neverSignedIn
            ? "Ce compte n’a encore aucune connexion réussie enregistrée. Une prise de contact rapide est recommandée."
            : "Ce compte a déjà réussi à se connecter auparavant. Contrôlez s’il s’agit d’une difficulté client ou d’une tentative non autorisée.",
        )}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed">${rows
          .map(([label, value, emphasis]) => mailRow(label, value, emphasis))
          .join("")}</table>
        <div style="margin-top:18px;padding:16px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;line-height:1.55"><strong>Action recommandée</strong><br>${escapeHtml(presentation.action)}</div>
      </div>
    </div>`;

  return { subject, text, html };
}
