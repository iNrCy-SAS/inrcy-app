import { createHmac, timingSafeEqual } from "node:crypto";

export const DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE =
  "inrcy_onboarding_launch_v1";
export const DASHBOARD_ONBOARDING_LAUNCH_PROOF_TTL_SECONDS = 2 * 60 * 60;

const FORMAT_VERSION = 1 as const;
const SIGNATURE_CONTEXT = "inrcy-dashboard-onboarding-launch-v1";
const ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LaunchProofPayload = {
  version: typeof FORMAT_VERSION;
  accountId: string;
  issuedAt: number;
  expiresAt: number;
};

function resolveSecret(secret?: string) {
  const value = String(
    secret || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  ).trim();
  if (value.length < 24) {
    throw new Error("Dashboard onboarding launch secret is unavailable.");
  }
  return value;
}

function sign(encodedPayload: string, secret?: string) {
  return createHmac("sha256", resolveSecret(secret))
    .update(SIGNATURE_CONTEXT, "utf8")
    .update(".", "utf8")
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createDashboardOnboardingLaunchProof(
  accountId: string,
  options?: { now?: number; secret?: string },
) {
  const normalizedAccountId = accountId.trim();
  if (!ACCOUNT_ID_PATTERN.test(normalizedAccountId)) {
    throw new Error("Dashboard onboarding launch account is invalid.");
  }
  const issuedAt = options?.now ?? Date.now();
  const payload: LaunchProofPayload = {
    version: FORMAT_VERSION,
    accountId: normalizedAccountId,
    issuedAt,
    expiresAt:
      issuedAt + DASHBOARD_ONBOARDING_LAUNCH_PROOF_TTL_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encodedPayload}.${sign(encodedPayload, options?.secret)}`;
}

export function matchesDashboardOnboardingLaunchProof(
  value: string | null | undefined,
  expectedAccountId: string,
  options?: { now?: number; secret?: string },
) {
  try {
    const normalizedExpectedAccountId = expectedAccountId.trim();
    if (
      !value ||
      value.length > 2_000 ||
      !ACCOUNT_ID_PATTERN.test(normalizedExpectedAccountId)
    ) {
      return false;
    }
    const [encodedPayload, receivedSignature, extra] = value.split(".");
    if (!encodedPayload || !receivedSignature || extra) return false;
    const expectedSignature = sign(encodedPayload, options?.secret);
    if (!safeEqual(receivedSignature, expectedSignature)) return false;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<LaunchProofPayload>;
    const now = options?.now ?? Date.now();
    return (
      payload.version === FORMAT_VERSION &&
      payload.accountId === normalizedExpectedAccountId &&
      typeof payload.issuedAt === "number" &&
      Number.isFinite(payload.issuedAt) &&
      payload.issuedAt <= now + 60_000 &&
      typeof payload.expiresAt === "number" &&
      Number.isFinite(payload.expiresAt) &&
      payload.expiresAt > now &&
      payload.expiresAt - payload.issuedAt ===
        DASHBOARD_ONBOARDING_LAUNCH_PROOF_TTL_SECONDS * 1000
    );
  } catch {
    return false;
  }
}

export function buildDashboardOnboardingLaunchProofCookie(accountId: string) {
  return {
    name: DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE,
    value: createDashboardOnboardingLaunchProof(accountId),
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DASHBOARD_ONBOARDING_LAUNCH_PROOF_TTL_SECONDS,
  };
}

export function buildClearedDashboardOnboardingLaunchProofCookie() {
  return {
    name: DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE,
    value: "",
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}
