import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildSignupFailureMail,
  createSignupFailureFingerprint,
  getSignupFailureErrorCode,
  getSignupFailureSafeMessage,
  maskSignupEmailForLog,
  type SignupFailureAlertInput,
} from "../../lib/signupFailureAlertPolicy.ts";
import { deliverSignupFailureAlert } from "../../lib/signupFailureAlertDelivery.ts";
import { isExistingAuthUserError } from "../../lib/supabaseAuthErrorPolicy.ts";

function sampleInput(overrides: Partial<SignupFailureAlertInput> = {}): SignupFailureAlertInput {
  return {
    source: "wordpress-elementor",
    stage: "profile_update",
    requestId: "request-123",
    occurredAt: "2026-08-30T15:00:00.000Z",
    userId: "user-123",
    authUserCreated: true,
    contact: {
      email: "pro@example.com",
      firstName: "Jeanne",
      lastName: "Martin",
      companyName: "Atelier Martin",
      phone: "+33 6 12 34 56 78",
      consent: true,
    },
    errorCode: "db_upsert_failed",
    errorMessage: "Écriture du profil impossible.",
    ...overrides,
  };
}

test("le fingerprint déduplique sans exposer les coordonnées", () => {
  const first = createSignupFailureFingerprint(sampleInput());
  const same = createSignupFailureFingerprint(
    sampleInput({
      contact: {
        ...sampleInput().contact,
        email: "  PRO@EXAMPLE.COM  ",
      },
    }),
  );
  const otherStage = createSignupFailureFingerprint(sampleInput({ stage: "trial_subscription" }));

  assert.equal(first, same);
  assert.notEqual(first, otherStage);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /pro|example|0612345678/i);
});

test("le mail conserve le contact mais neutralise HTML et secrets techniques", () => {
  const malicious = sampleInput({
    contact: {
      ...sampleInput().contact,
      firstName: "<script>alert(1)</script>",
    },
    errorMessage:
      "password=hunter2 token=abc secret=xyz Authorization: Bearer qqq cookie=foo https://app.inrcy.com/api?token=url-secret",
  });
  const safeMessage = getSignupFailureSafeMessage({ message: malicious.errorMessage });
  const mail = buildSignupFailureMail({ ...malicious, errorMessage: safeMessage });
  const rendered = `${mail.subject}\n${mail.text}\n${mail.html}`;

  for (const secret of ["hunter2", "token=abc", "secret=xyz", "qqq", "cookie=foo", "url-secret"]) {
    assert.doesNotMatch(rendered, new RegExp(secret, "i"));
  }
  assert.doesNotMatch(mail.html, /<script>alert\(1\)<\/script>/i);
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/i);
  assert.match(mail.text, /pro@example\.com/);
  assert.match(mail.text, /\+33 6 12 34 56 78/);
  assert.match(mail.subject, /compte partiellement créé/i);
});

test("les logs masquent l'email et normalisent le code d'erreur", () => {
  assert.equal(maskSignupEmailForLog("Professionnel@Example.com"), "pr******@example.com");
  assert.equal(getSignupFailureErrorCode({ code: " DB / WRITE FAILED " }), "db_write_failed");
});

test("vingt alertes concurrentes identiques n'envoient qu'un mail", async () => {
  const claimed = new Set<string>();
  const alreadySent = new Set<string>();
  let sent = 0;
  let committed = 0;

  const dependencies = {
    destination: "compte@inrcy.com",
    claim: async (fingerprint: string) => {
      if (alreadySent.has(fingerprint)) return { status: "sent" as const };
      if (claimed.has(fingerprint)) return { status: "pending" as const };
      claimed.add(fingerprint);
      return {
        status: "acquired" as const,
        claim: { key: fingerprint, remote: false, token: `pending:${fingerprint}` },
      };
    },
    commit: async (claim: { key: string }) => {
      committed += 1;
      claimed.delete(claim.key);
      alreadySent.add(claim.key);
    },
    release: async (claim: { key: string }) => {
      claimed.delete(claim.key);
    },
    sendMail: async () => {
      sent += 1;
    },
  };

  const results = await Promise.all(
    Array.from({ length: 20 }, () => deliverSignupFailureAlert(sampleInput(), dependencies)),
  );

  assert.equal(sent, 1);
  assert.equal(committed, 1);
  assert.equal(results.filter((result) => result.inFlight).length, 19);

  const afterCommit = await deliverSignupFailureAlert(sampleInput(), dependencies);
  assert.equal(afterCommit.deduplicated, true);
  assert.equal(sent, 1);
});

test("une panne SMTP libère la déduplication pour la tentative suivante", async () => {
  const claimed = new Set<string>();
  let attempts = 0;
  let releases = 0;

  const dependencies = {
    destination: "compte@inrcy.com",
    claim: async (fingerprint: string) => {
      if (claimed.has(fingerprint)) return { status: "pending" as const };
      claimed.add(fingerprint);
      return {
        status: "acquired" as const,
        claim: { key: fingerprint, remote: false, token: `pending:${fingerprint}` },
      };
    },
    commit: async () => undefined,
    release: async (claim: { key: string }) => {
      releases += 1;
      claimed.delete(claim.key);
    },
    sendMail: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("smtp unavailable");
    },
  };

  await assert.rejects(deliverSignupFailureAlert(sampleInput(), dependencies), /smtp unavailable/);
  const retry = await deliverSignupFailureAlert(sampleInput(), dependencies);

  assert.equal(releases, 1);
  assert.equal(attempts, 2);
  assert.equal(retry.sent, true);
});

test("seuls les vrais doublons Auth deviennent des 409 métier", () => {
  for (const error of [
    { code: "user_already_exists" },
    { code: "email_exists" },
    { message: "User already registered" },
    { message: "A user with this email address has already been registered" },
  ]) {
    assert.equal(isExistingAuthUserError(error), true);
  }

  for (const error of [
    { message: "connection already closed" },
    { message: "user is not registered" },
    { message: "database already unavailable" },
  ]) {
    assert.equal(isExistingAuthUserError(error), false);
  }
});

test("la route câble l'alerte uniquement dans son catch technique", () => {
  const route = readFileSync("app/api/public/trial-signup/route.ts", "utf8");
  const helper = readFileSync("lib/signupFailureAlert.ts", "utf8");
  const delivery = readFileSync("lib/signupFailureAlertDelivery.ts", "utf8");

  assert.match(route, /acceptedAttempt = true/);
  assert.match(route, /await sendSignupFailureAlert\(alertInput\)/);
  assert.match(route, /"X-InrCy-Signup-Alert": alertDelivery/);
  assert.doesNotMatch(route, /after\(async/);
  assert.match(route, /stage = "auth_invitation"/);
  assert.match(route, /authUserCreated = true/);
  assert.match(route, /captureApiException\(req, error/);
  assert.match(helper, /nx: true/);
  assert.match(helper, /existing === "sent"/);
  assert.match(helper, /status: "pending"/);
  assert.match(helper, /redis\.eval\(/);
  assert.match(delivery, /await dependencies\.release\(claim\)/);
  assert.match(delivery, /inFlight: true/);
  assert.match(helper, /INRCY_NEW_USER_ALERT_EMAIL", "compte@inrcy\.com"/);
});

test("le filet WordPress observe le webhook sans toucher aux inscriptions réussies", () => {
  const wordpress = readFileSync(
    "ops/wordpress-signup-safety-net/inrcy-signup-safety-net.php",
    "utf8",
  );

  assert.match(wordpress, /elementor_pro\/forms\/webhooks\/response/);
  assert.match(wordpress, /http_api_debug/);
  assert.match(wordpress, /pre_http_request/);
  assert.match(wordpress, /host === 'app\.inrcy\.com'/);
  assert.match(wordpress, /path === '\/api\/public\/trial-signup'/);
  assert.match(wordpress, /inrcy_signup_safety_read_contact_from_payload/);
  assert.match(wordpress, /define\('INRCY_SIGNUP_SAFETY_FORM_ID', '405c24a'\)/);
  assert.match(wordpress, /define\('INRCY_SIGNUP_SAFETY_FORM_NAME', 'essai_inrcy_30j'\)/);
  assert.match(wordpress, /x-inrcy-signup-alert/);
  assert.match(wordpress, /array\('sent', 'deduplicated'\)/);
  assert.match(wordpress, /alert_sent/);
  assert.match(wordpress, /alert_deduplicated/);
  assert.match(wordpress, /\(\$body\['alert_sent'\] \?\? null\) === true/);
  assert.match(wordpress, /\$status >= 200 && \$status < 300/);
  assert.match(wordpress, /\(\$body\['ok'\] \?\? null\) !== true/);
  assert.match(wordpress, /array\(400, 409, 422\)/);
  assert.doesNotMatch(wordpress, /array\(400, 409, 422, 429\)/);
  assert.match(wordpress, /empty\(\$contact\['consent'\]\)/);
  assert.match(wordpress, /\$contact\['honeypot'\] !== ''/);
  assert.match(wordpress, /get_transient\(\$dedupe_key\)/);
  assert.match(wordpress, /INSERT IGNORE INTO \{\$wpdb->options\}/);
  assert.match(wordpress, /return \$result === 0 \? 'exists' : 'error'/);
  assert.match(wordpress, /outbox unavailable; direct_mail=/);
  assert.match(wordpress, /\$replace_required = !is_array\(\$existing\)/);
  assert.match(wordpress, /Impossible de prouver qu'il s'agit d'un vrai doublon/);
  assert.match(wordpress, /inrcy_signup_safety_acquire_lease/);
  assert.match(wordpress, /INRCY_SIGNUP_SAFETY_LEASE_SECONDS', 900/);
  assert.match(wordpress, /wp_schedule_single_event\(/);
  assert.match(wordpress, /\$force_successor = false/);
  assert.match(wordpress, /as_schedule_recurring_action\(/);
  assert.match(wordpress, /inrcy_signup_safety_sweep_outbox/);
  assert.match(wordpress, /inrcy_signup_safety_sweep_cursor/);
  assert.match(wordpress, /INRCY_SIGNUP_SAFETY_OUTBOX_MAX_AGE', 30 \* 86400/);
  assert.match(wordpress, /if \(!function_exists\('inrcy_signup_safety_handle_failure'\)\) \{/);
  assert.match(wordpress, /wp_mail\(/);
  assert.match(wordpress, /'compte@inrcy\.com'/);
  assert.doesNotMatch(wordpress, /get_error_data\(/);
});
