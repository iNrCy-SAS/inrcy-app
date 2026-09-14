import { Resend } from "resend";
import { Webhook } from "standardwebhooks";

import { AuthMailPayloadError } from "./authMailPolicy.ts";

export type StandardWebhookHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

function clean(value: unknown, maxLength = 2_000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function readStandardWebhookHeaders(
  headers: Pick<Headers, "get">,
  prefix: "webhook" | "svix",
): StandardWebhookHeaders {
  const result = {
    id: clean(headers.get(`${prefix}-id`), 256),
    timestamp: clean(headers.get(`${prefix}-timestamp`), 80),
    signature: clean(headers.get(`${prefix}-signature`), 2_000),
  };
  if (!result.id || !result.timestamp || !result.signature) {
    throw new AuthMailPayloadError("missing_signature_headers", "Webhook signature headers are missing");
  }
  return result;
}

export function verifySupabaseAuthEmailHook(args: {
  rawBody: string;
  headers: StandardWebhookHeaders;
  secret: string;
}) {
  const secret = clean(args.secret, 2_000).replace(/^v1,/, "");
  if (!secret) {
    throw new AuthMailPayloadError("missing_hook_secret", "Supabase Auth hook secret is missing");
  }
  const verifier = new Webhook(secret);
  return verifier.verify(args.rawBody, {
    "webhook-id": args.headers.id,
    "webhook-timestamp": args.headers.timestamp,
    "webhook-signature": args.headers.signature,
  });
}

export function verifyResendAuthEmailWebhook(args: {
  rawBody: string;
  headers: StandardWebhookHeaders;
  webhookSecret: string;
  apiKey: string;
}) {
  const webhookSecret = clean(args.webhookSecret, 2_000);
  const apiKey = clean(args.apiKey, 2_000);
  if (!webhookSecret || !apiKey) {
    throw new AuthMailPayloadError("missing_resend_configuration", "Resend webhook configuration is missing");
  }
  return new Resend(apiKey).webhooks.verify({
    payload: args.rawBody,
    headers: args.headers,
    webhookSecret,
  });
}
