import assert from "node:assert/strict";
import test from "node:test";

import {
  isSmtpProtocolVersionHandshakeAlert,
  verifySmtpWithHandshakeRetry,
} from "../../lib/health/smtpRetryPolicy.ts";

const protocolAlert = Object.assign(
  new Error("ssl3_read_bytes:tlsv1 alert protocol version: SSL alert number 70"),
  { command: "CONN" },
);

test("la seule alerte TLS de négociation rapide donne lieu à un second verify", async () => {
  const attempts: number[] = [];
  const delays: number[] = [];
  await verifySmtpWithHandshakeRetry(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt === 1) throw protocolAlert;
    },
    { now: () => 1_000, wait: async (ms) => { delays.push(ms); } },
  );
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(delays, [250]);
});

test("un refus d'authentification ou une alerte tardive ne déclenche aucun retry", async () => {
  const authFailure = Object.assign(new Error("535 Authentication failed"), { command: "AUTH PLAIN" });
  let attempts = 0;
  await assert.rejects(
    verifySmtpWithHandshakeRetry(async () => { attempts++; throw authFailure; }),
    authFailure,
  );
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(
    verifySmtpWithHandshakeRetry(
      async () => { attempts++; throw protocolAlert; },
      { now: (() => { let value = 0; return () => (value += 2_001); })(), wait: async () => {} },
    ),
    protocolAlert,
  );
  assert.equal(attempts, 1);
});

test("le second échec TLS reste visible au healthcheck sans troisième essai", async () => {
  let attempts = 0;
  await assert.rejects(
    verifySmtpWithHandshakeRetry(
      async () => { attempts++; throw protocolAlert; },
      { now: () => 1_000, wait: async () => {} },
    ),
    protocolAlert,
  );
  assert.equal(attempts, 2);
});

test("l'alerte TLS pendant AUTH n'est jamais réessayée", () => {
  assert.equal(
    isSmtpProtocolVersionHandshakeAlert(
      Object.assign(new Error(protocolAlert.message), { command: "AUTH LOGIN" }),
    ),
    false,
  );
});
