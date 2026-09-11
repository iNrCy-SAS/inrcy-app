import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deliverLoginFailureAlert,
  getLoginFailureCounterKey,
  resetLoginFailureCounters,
} from "../../lib/loginFailureAlertDelivery.ts";
import {
  buildLoginFailureAlertMail,
  createLoginTelemetryFingerprint,
  getLoginFailureThreshold,
  parseLoginFailureSignal,
  resolveUniqueLoginIdentity,
  type LoginFailureMailInput,
} from "../../lib/loginFailureAlertPolicy.ts";

function mailInput(
  overrides: Partial<LoginFailureMailInput> = {},
): LoginFailureMailInput {
  return {
    category: "invalidCredentials",
    errorCode: "invalid_credentials",
    errorStatus: 400,
    failureCount: 0,
    occurredAt: "2026-09-11T10:00:00.000Z",
    userId: "5d524543-6f8b-4594-b1b4-5b7b128ab32e",
    canonicalEmail: "client@example.com",
    firstName: "Alice",
    lastName: "Martin",
    companyName: "Abri Easyconcept",
    phone: "+33 6 12 34 56 78",
    createdAt: "2026-09-10T10:00:00.000Z",
    lastSignInAt: null,
    emailConfirmedAt: "2026-09-10T11:00:00.000Z",
    matchSources: ["profiles.admin_email"],
    ...overrides,
  };
}

test("le contrat accepte uniquement les deux payloads stricts et préfère les codes Supabase stables", () => {
  assert.deepEqual(parseLoginFailureSignal({ kind: "success" }), { kind: "success" });
  assert.deepEqual(
    parseLoginFailureSignal({
      kind: "failure",
      email: "  CLIENT@Example.com ",
      error_code: "invalid_credentials",
      error_status: 400,
      category: "technical",
    }),
    {
      kind: "failure",
      email: "client@example.com",
      errorCode: "invalid_credentials",
      errorStatus: 400,
      category: "invalidCredentials",
    },
  );
  const unconfirmed = parseLoginFailureSignal({
      kind: "failure",
      email: "client@example.com",
      error_code: "email_not_confirmed",
      error_status: 400,
      category: "invalidCredentials",
    });
  assert.equal(unconfirmed?.kind, "failure");
  if (unconfirmed?.kind === "failure") {
    assert.equal(unconfirmed.category, "emailUnconfirmed");
  }

  for (const invalid of [
    { kind: "success", email: "client@example.com" },
    {
      kind: "failure",
      email: "client@example.com",
      error_code: "invalid_credentials",
      error_status: 400,
      category: "invalidCredentials",
      password: "ne-doit-jamais-arriver",
    },
    {
      kind: "failure",
      email: "client@example.com",
      error_code: "invalid credentials: détail libre",
      error_status: 400,
      category: "invalidCredentials",
    },
    {
      kind: "failure",
      email: "invalide",
      error_code: null,
      error_status: null,
      category: "network",
    },
  ]) {
    assert.equal(parseLoginFailureSignal(invalid), null);
  }
});

test("les seuils sont 3 pour identifiants, 1 pour non confirmé et 2 pour les autres erreurs", () => {
  assert.equal(getLoginFailureThreshold("invalidCredentials"), 3);
  assert.equal(getLoginFailureThreshold("emailUnconfirmed"), 1);
  for (const category of [
    "linkUnavailable",
    "network",
    "storage",
    "service",
    "technical",
  ] as const) {
    assert.equal(getLoginFailureThreshold(category), 2);
  }
});

test("le rapprochement exige un seul UID et refiltre l'adresse exacte", () => {
  assert.deepEqual(
    resolveUniqueLoginIdentity({
      email: "client_test@example.com",
      profilesByAdminEmail: [
        { user_id: "wildcard", admin_email: "clientXtest@example.com" },
      ],
      profilesByContactEmail: [],
      subscriptionsByContactEmail: [],
    }),
    { status: "unknown" },
  );

  const matched = resolveUniqueLoginIdentity({
    email: "CLIENT@example.com",
    profilesByAdminEmail: [
      {
        user_id: "user-1",
        admin_email: "client@example.com",
        company_legal_name: "Société sûre",
      },
    ],
    profilesByContactEmail: [
      { user_id: "user-1", contact_email: "CLIENT@example.com" },
    ],
    subscriptionsByContactEmail: [
      { user_id: "user-1", contact_email: "client@example.com" },
    ],
  });
  assert.equal(matched.status, "matched");
  if (matched.status === "matched") {
    assert.equal(matched.userId, "user-1");
    assert.deepEqual(matched.sources, [
      "profiles.admin_email",
      "profiles.contact_email",
      "subscriptions.contact_email",
    ]);
  }

  const ambiguous = resolveUniqueLoginIdentity({
    email: "shared@example.com",
    profilesByAdminEmail: [
      { user_id: "user-1", admin_email: "shared@example.com" },
    ],
    profilesByContactEmail: [],
    subscriptionsByContactEmail: [
      { user_id: "user-2", contact_email: "shared@example.com" },
    ],
  });
  assert.deepEqual(ambiguous, { status: "ambiguous", candidateCount: 2 });
});

test("le mail n'utilise que l'identité canonique serveur et neutralise le HTML", () => {
  const mail = buildLoginFailureAlertMail(
    mailInput({
      canonicalEmail: "canonical@example.com",
      companyName: "<img src=x onerror=alert(1)>",
    }),
  );
  const rendered = `${mail.subject}\n${mail.text}\n${mail.html}`;
  assert.match(rendered, /canonical@example\.com/);
  assert.doesNotMatch(rendered, /adresse-saisie-par-un-attaquant/i);
  assert.doesNotMatch(mail.html, /<img src=x/i);
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/i);
  assert.match(mail.text, /aucune connexion réussie/i);
  assert.match(mail.text, /Ne pas supprimer son compte/i);
});

test("les fingerprints sont des HMAC courts et ne révèlent ni email ni IP", () => {
  const email = createLoginTelemetryFingerprint("client@example.com", "secret-a");
  const same = createLoginTelemetryFingerprint(" CLIENT@example.com ", "secret-a");
  const otherKey = createLoginTelemetryFingerprint("client@example.com", "secret-b");
  assert.equal(email, same);
  assert.notEqual(email, otherKey);
  assert.match(email, /^[a-f0-9]{24}$/);
  assert.doesNotMatch(email, /client|example/);
});

test("trois échecs en quinze minutes déclenchent un seul mail et les suivants sont dédupliqués", async () => {
  let count = 0;
  let sent = 0;
  let state: "free" | "pending" | "sent" = "free";
  const dependencies = {
    destination: "contact@inrcy.com",
    increment: async () => ++count,
    claim: async () => {
      if (state === "sent") return { status: "sent" as const };
      if (state === "pending") return { status: "pending" as const };
      state = "pending";
      return {
        status: "acquired" as const,
        claim: { key: "claim", remote: false, token: "pending:1" },
      };
    },
    commit: async () => {
      state = "sent";
    },
    release: async () => {
      state = "free";
    },
    reserveGlobalCapacity: async () => true,
    sendMail: async () => {
      sent += 1;
    },
  };

  assert.equal((await deliverLoginFailureAlert(mailInput(), dependencies)).status, "below_threshold");
  assert.equal((await deliverLoginFailureAlert(mailInput(), dependencies)).status, "below_threshold");
  assert.equal((await deliverLoginFailureAlert(mailInput(), dependencies)).status, "sent");
  assert.equal((await deliverLoginFailureAlert(mailInput(), dependencies)).status, "deduplicated");
  assert.equal(sent, 1);
});

test("un succès authentifié réinitialise chaque compteur de catégorie du seul UID de session", async () => {
  const userId = "session-user-id";
  const categories = ["invalidCredentials", "emailUnconfirmed", "technical"] as const;
  const localCounters = new Map(
    categories.map((category) => [getLoginFailureCounterKey(userId, category), 4]),
  );
  let remoteKeys: readonly string[] = [];

  await resetLoginFailureCounters(userId, categories, {
    clearLocal: (keys) => {
      for (const key of keys) localCounters.delete(key);
    },
    clearRemote: async (keys) => {
      remoteKeys = keys;
    },
  });

  assert.equal(localCounters.size, 0);
  assert.deepEqual(
    remoteKeys,
    categories.map((category) => getLoginFailureCounterKey(userId, category)),
  );
});

test("non confirmé est immédiat, les erreurs techniques attendent le second signal", async () => {
  const outcomes: string[] = [];
  for (const category of ["emailUnconfirmed", "technical", "technical"] as const) {
    let count = outcomes.filter((value) => value.startsWith(category)).length;
    const result = await deliverLoginFailureAlert(mailInput({ category }), {
      destination: "contact@inrcy.com",
      increment: async () => ++count,
      claim: async () => ({
        status: "acquired",
        claim: { key: category, remote: false, token: `pending:${category}` },
      }),
      commit: async () => undefined,
      release: async () => undefined,
      reserveGlobalCapacity: async () => true,
      sendMail: async () => undefined,
    });
    outcomes.push(`${category}:${result.status}`);
  }
  assert.equal(outcomes[0], "emailUnconfirmed:sent");
  assert.equal(outcomes[1], "technical:below_threshold");
  assert.equal(outcomes[2], "technical:sent");
});

test("vingt traitements concurrents ne peuvent acquérir qu'un envoi", async () => {
  let count = 0;
  let claimed = false;
  let sent = 0;
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      deliverLoginFailureAlert(mailInput(), {
        destination: "contact@inrcy.com",
        increment: async () => ++count,
        claim: async () => {
          if (claimed) return { status: "pending" as const };
          claimed = true;
          return {
            status: "acquired" as const,
            claim: { key: "one", remote: false, token: "pending:one" },
          };
        },
        commit: async () => undefined,
        release: async () => {
          claimed = false;
        },
        reserveGlobalCapacity: async () => true,
        sendMail: async () => {
          sent += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
      }),
    ),
  );
  assert.equal(sent, 1);
  assert.equal(results.filter((result) => result.status === "sent").length, 1);
});

test("une panne SMTP libère le claim et le plafond global libère aussi sans envoyer", async () => {
  let claimed = false;
  let releases = 0;
  let attempts = 0;
  const base = {
    destination: "contact@inrcy.com",
    increment: async () => 3,
    claim: async () => {
      if (claimed) return { status: "pending" as const };
      claimed = true;
      return {
        status: "acquired" as const,
        claim: { key: "retry", remote: false, token: "pending:retry" },
      };
    },
    commit: async () => undefined,
    release: async () => {
      releases += 1;
      claimed = false;
    },
  };

  await assert.rejects(
    deliverLoginFailureAlert(mailInput(), {
      ...base,
      reserveGlobalCapacity: async () => true,
      sendMail: async () => {
        attempts += 1;
        throw new Error("smtp indisponible");
      },
    }),
    /smtp indisponible/,
  );
  assert.equal(releases, 1);

  const limited = await deliverLoginFailureAlert(mailInput(), {
    ...base,
    reserveGlobalCapacity: async () => false,
    sendMail: async () => {
      attempts += 1;
    },
  });
  assert.equal(limited.status, "globally_limited");
  assert.equal(releases, 2);
  assert.equal(attempts, 1);
});

test("la route reste opaque, bornée et ne transmet aucun secret d'authentification", () => {
  const route = readFileSync("app/api/public/login-failure-alert/route.ts", "utf8");
  const backend = readFileSync("lib/loginFailureAlert.ts", "utf8");
  const policy = readFileSync("lib/loginFailureAlertPolicy.ts", "utf8");
  const all = `${route}\n${backend}\n${policy}`;

  assert.match(route, /status:\s*202/);
  assert.match(route, /"Cache-Control":\s*"no-store"/);
  assert.match(route, /MAX_PAYLOAD_BYTES\s*=\s*2_048/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /createSupabaseServer\(\)/);
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /clearLoginFailureCountersForUser/);
  assert.match(backend, /REQUIRED_ALERT_RECIPIENT\s*=\s*"contact@inrcy\.com"/);
  assert.match(backend, /FORBIDDEN_ALERT_RECIPIENT\s*=\s*"compte@inrcy\.com"/);
  assert.match(backend, /nx:\s*true/);
  assert.match(backend, /login-failure-mail:v1/);
  assert.match(backend, /login-failure-mail-cap:v1:global/);
  assert.match(backend, /email_fingerprint/);
  assert.match(backend, /ip_fingerprint/);
  assert.match(policy, /hasExactKeys/);

  assert.doesNotMatch(all, /body\??\.(?:password|token)|body\[['"](?:password|token)['"]\]/i);
  assert.doesNotMatch(all, /error_message\s*:/i);
  assert.doesNotMatch(all, /ip:\s*(?:rawIp|getClientIp)/);
  assert.doesNotMatch(all, /console\.(?:log|warn|error)/);
});
