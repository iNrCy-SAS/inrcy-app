import { createHmac, timingSafeEqual } from "node:crypto";

import {
  createSignupFormSnapshot,
  SIGNUP_FORM_METADATA_KEY,
  type SignupFormSnapshot,
} from "./signupFormSnapshot.ts";

export const SIGNUP_RECOVERY_METADATA_KEY = "inrcy_signup_recovery_v1";
export const SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY = "inrcy_public_trial_completed_at";
export const SIGNUP_RECOVERY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type RecoveryProof = {
  version: 1;
  issuedAt: string;
  trialDays: number;
  signature: string;
};

export type RecoveryClaim = {
  snapshot: SignupFormSnapshot;
  trialStartAt: string;
  trialEndAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonicalSnapshot(value: unknown): SignupFormSnapshot | null {
  const original = asRecord(value);
  if (original.version !== 1 || original.consent !== true) return null;
  const snapshot = createSignupFormSnapshot(original);
  if (!snapshot.email || snapshot.email !== snapshot.email.toLowerCase()) return null;
  return snapshot;
}

function signatureInput(snapshot: SignupFormSnapshot, issuedAt: string, trialDays: number) {
  return JSON.stringify([
    1,
    issuedAt,
    trialDays,
    snapshot.version,
    snapshot.lastName,
    snapshot.firstName,
    snapshot.email,
    snapshot.companyName,
    snapshot.phone,
    snapshot.consent,
  ]);
}

function sign(snapshot: SignupFormSnapshot, issuedAt: string, trialDays: number, secret: string) {
  if (!secret.trim()) throw new Error("signup_recovery_secret_missing");
  return createHmac("sha256", secret)
    .update("inrcy:public-trial-signup-recovery:v1\0", "utf8")
    .update(signatureInput(snapshot, issuedAt, trialDays), "utf8")
    .digest("hex");
}

export function createSignupRecoveryProof(
  snapshot: SignupFormSnapshot,
  secret: string,
  input: { issuedAt: string; trialDays: number },
): RecoveryProof {
  const canonical = canonicalSnapshot(snapshot);
  if (!canonical || !Number.isInteger(input.trialDays) || input.trialDays < 1 || input.trialDays > 365) {
    throw new Error("signup_recovery_proof_invalid_input");
  }
  const issuedMs = Date.parse(input.issuedAt);
  if (!Number.isFinite(issuedMs) || new Date(issuedMs).toISOString() !== input.issuedAt) {
    throw new Error("signup_recovery_proof_invalid_time");
  }
  return {
    version: 1,
    issuedAt: input.issuedAt,
    trialDays: input.trialDays,
    signature: sign(canonical, input.issuedAt, input.trialDays, secret),
  };
}

/** Metadata is editable by a signed-in user; only the server HMAC grants recovery. */
export function verifySignupRecoveryProof(
  metadataValue: unknown,
  secret: string,
  nowMs = Date.now(),
): RecoveryClaim | null {
  const metadata = asRecord(metadataValue);
  const snapshot = canonicalSnapshot(metadata[SIGNUP_FORM_METADATA_KEY]);
  const proof = asRecord(metadata[SIGNUP_RECOVERY_METADATA_KEY]);
  if (!snapshot || proof.version !== 1 || typeof proof.issuedAt !== "string" ||
      !Number.isInteger(proof.trialDays) || Number(proof.trialDays) < 1 || Number(proof.trialDays) > 365 ||
      typeof proof.signature !== "string" || !/^[a-f0-9]{64}$/.test(proof.signature)) {
    return null;
  }

  const issuedMs = Date.parse(proof.issuedAt);
  if (!Number.isFinite(issuedMs) || new Date(issuedMs).toISOString() !== proof.issuedAt ||
      issuedMs > nowMs + 5 * 60 * 1000 || nowMs - issuedMs > SIGNUP_RECOVERY_MAX_AGE_MS) {
    return null;
  }

  const trialDays = Number(proof.trialDays);
  const trialEndMs = issuedMs + trialDays * 24 * 60 * 60 * 1000;
  if (trialEndMs <= nowMs) return null;

  const expected = Buffer.from(sign(snapshot, proof.issuedAt, trialDays, secret), "hex");
  const supplied = Buffer.from(proof.signature, "hex");
  if (!timingSafeEqual(expected, supplied)) return null;

  return {
    snapshot,
    trialStartAt: proof.issuedAt,
    trialEndAt: new Date(trialEndMs).toISOString(),
  };
}
