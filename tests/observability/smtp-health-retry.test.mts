import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  isSmtpProtocolVersionHandshakeAlert,
  createSmtpHandshakeRetryGuard,
  verifySmtpWithHandshakeRetry,
  withSmtpHandshakeRetry,
} from "../../lib/health/smtpRetryPolicy.ts";

const protocolAlert = Object.assign(
  new Error("ssl3_read_bytes:tlsv1 alert protocol version: SSL alert number 70"),
  { code: "ESOCKET", command: "CONN" },
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

test("un envoi reprend seulement avant AUTH et retourne le résultat de livraison", async () => {
  const attempts: number[] = [];
  let acceptedMessages = 0;
  const receipt = { messageId: "<validation-1@example.invalid>", accepted: ["recipient@example.invalid"] };
  const result = await withSmtpHandshakeRetry(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt === 1) throw protocolAlert;
      acceptedMessages++;
      return receipt;
    },
    { now: () => 1_000, wait: async () => {} },
  );
  assert.equal(result, receipt);
  assert.equal(acceptedMessages, 1);
  assert.deepEqual(attempts, [1, 2]);
});

test("une commande inconnue ou un échec après connexion ne peut jamais doubler un envoi", async () => {
  for (const command of [undefined, "", "AUTH PLAIN", "MAIL FROM", "RCPT TO", "DATA", "QUIT", "STARTTLS"]) {
    let attempts = 0;
    const error = Object.assign(new Error(protocolAlert.message), { code: "ESOCKET", command });
    await assert.rejects(
      withSmtpHandshakeRetry(
        async () => { attempts++; throw error; },
        { now: () => 1_000, wait: async () => {} },
      ),
      error,
    );
    assert.equal(attempts, 1, `command=${command}`);
  }
});

test("un timeout ou un certificat refusé conserve son échec sans nouvelle tentative", async () => {
  for (const error of [
    Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT", command: "CONN" }),
    Object.assign(new Error("self-signed certificate in certificate chain"), { code: "ESOCKET", command: "CONN" }),
    Object.assign(new Error(protocolAlert.message), { command: "CONN" }),
  ]) {
    let attempts = 0;
    await assert.rejects(
      withSmtpHandshakeRetry(
        async () => { attempts++; throw error; },
        { now: () => 1_000, wait: async () => {} },
      ),
      error,
    );
    assert.equal(attempts, 1);
  }
});

test("Nodemailer signale AUTH et DATA à la garde avant écriture sur le socket", () => {
  const require = createRequire(import.meta.url);
  const SMTPConnection = require("nodemailer/lib/smtp-connection") as {
    prototype: { _sendCommand: (command: string) => void };
  };
  const guard = createSmtpHandshakeRetryGuard();
  const observed: { command: string; canRetry: boolean }[] = [];
  const connection = {
    _destroyed: false,
    options: { transactionLog: true },
    logger: guard.logger,
    _socket: {
      destroyed: false,
      write: (data: Buffer) => {
        observed.push({ command: data.toString().trim(), canRetry: guard.canRetry() });
      },
    },
  };
  for (const command of ["EHLO test.invalid", "STARTTLS", "EHLO test.invalid", "AUTH LOGIN", "MAIL FROM:<sender@example.invalid>", "DATA"]) {
    SMTPConnection.prototype._sendCommand.call(connection, command);
  }
  assert.deepEqual(observed.map((entry) => entry.canRetry), [true, true, true, false, false, false]);
});

test("une erreur marquée CONN après la négociation ne rejoue jamais le message", async () => {
  for (const [transaction, message] of [
    ["smtp", "SMTP handshake finished"],
    ["auth", ""],
    ["message", ""],
    ["client", "AUTH LOGIN"],
    ["client", "DATA"],
  ]) {
    const guard = createSmtpHandshakeRetryGuard();
    let attempts = 0;
    await assert.rejects(
      withSmtpHandshakeRetry(
        async () => {
          attempts++;
          guard.logger.debug({ tnx: transaction }, message);
          guard.logger.debug({ tnx: "smtp" }, 'Closing connection to the server using "%s"');
          throw protocolAlert;
        },
        { now: () => 1_000, wait: async () => {}, canRetry: guard.canRetry },
      ),
      protocolAlert,
    );
    assert.equal(attempts, 1);
  }
});

test("le vrai cycle erreur puis fermeture Nodemailer préserve la reprise du handshake", async () => {
  const require = createRequire(import.meta.url);
  const SMTPConnection = require("nodemailer/lib/smtp-connection") as new (options: {
    logger: ReturnType<typeof createSmtpHandshakeRetryGuard>["logger"];
    transactionLog: boolean;
  }) => {
    once: (event: string, listener: (error: Error) => void) => void;
    _onError: (error: Error, type: string, data: false, command: string) => void;
  };
  const guard = createSmtpHandshakeRetryGuard();
  const events: string[] = [];
  const logger = {
    ...guard.logger,
    debug: (data: unknown, message?: unknown) => {
      if (String(message).startsWith("Closing connection to the server")) events.push("close");
      guard.logger.debug(data, message);
    },
  };
  let attempts = 0;
  const result = await withSmtpHandshakeRetry(
    async (attempt) => {
      attempts++;
      if (attempt === 2) return "delivered-once";
      const connection = new SMTPConnection({ logger, transactionLog: true });
      await new Promise<void>((_resolve, reject) => {
        connection.once("error", (error) => {
          events.push("error");
          reject(error);
        });
        connection._onError(new Error(protocolAlert.message), "ESOCKET", false, "CONN");
      });
      throw new Error("The injected handshake error must reject");
    },
    {
      now: () => 1_000,
      wait: async () => { events.push("retry"); },
      canRetry: guard.canRetry,
    },
  );
  assert.equal(result, "delivered-once");
  assert.equal(attempts, 2);
  assert.deepEqual(events, ["error", "close", "retry"]);
});
