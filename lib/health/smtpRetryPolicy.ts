const MAX_FIRST_HANDSHAKE_MS = 2_000;
const RETRY_DELAY_MS = 250;

export function isSmtpProtocolVersionHandshakeAlert(error: unknown): boolean {
  const candidate = error as { message?: unknown; command?: unknown } | null;
  const message = String(candidate?.message || "");
  const command = String(candidate?.command || "").trim().toUpperCase();

  // This OpenSSL alert is raised during TLS negotiation, before any SMTP
  // message is accepted. Never retry authentication or delivery failures.
  return /(?:tlsv1 alert protocol version|SSL alert number 70)/i.test(message)
    && !/^(?:AUTH|MAIL|RCPT|DATA)(?:\s|$)/.test(command);
}

export async function verifySmtpWithHandshakeRetry(
  verify: (attempt: 1 | 2) => Promise<void>,
  options: {
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const now = options.now || Date.now;
  const wait = options.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();

  try {
    await verify(1);
  } catch (error) {
    if (
      !isSmtpProtocolVersionHandshakeAlert(error)
      || now() - started > MAX_FIRST_HANDSHAKE_MS
    ) {
      throw error;
    }
    await wait(RETRY_DELAY_MS);
    await verify(2);
  }
}
