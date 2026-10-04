const MAX_FIRST_HANDSHAKE_MS = 2_000;
const RETRY_DELAY_MS = 250;

export function createSmtpHandshakeRetryGuard() {
  let beforeAuthentication = true;
  const observe = (data: unknown, message?: unknown) => {
    const transaction = (data as { tnx?: unknown } | null)?.tnx;
    if (
      (transaction === "smtp" && message === "SMTP handshake finished")
      || transaction === "auth"
      || transaction === "message"
      || (transaction === "client" && !/^(?:EHLO|HELO|LHLO|STARTTLS)(?:\s|$)/i.test(String(message || "")))
    ) {
      beforeAuthentication = false;
    }
  };

  // Nodemailer labels all socket errors CONN, including errors after DATA.
  // Observe protocol progress without emitting or retaining credentials,
  // recipients or content. transactionLog excludes the message body. The
  // smtp closing event also follows failed handshakes and does not mean AUTH
  // or delivery began; only the handshake-finished event closes that window.
  return {
    canRetry: () => beforeAuthentication,
    logger: {
      level: () => {},
      trace: observe,
      debug: observe,
      info: observe,
      warn: observe,
      error: observe,
      fatal: observe,
    },
  };
}

export function isSmtpProtocolVersionHandshakeAlert(error: unknown): boolean {
  const candidate = error as { message?: unknown; command?: unknown; code?: unknown } | null;
  const message = String(candidate?.message || "");
  const command = String(candidate?.command || "").trim().toUpperCase();
  const code = String(candidate?.code || "").trim().toUpperCase();

  // This OpenSSL alert is raised during TLS negotiation, before any SMTP
  // message is accepted. Never retry authentication or delivery failures.
  return code === "ESOCKET"
    && command === "CONN"
    && /(?:tlsv1 alert protocol version|SSL alert number 70)/i.test(message);
}

export async function withSmtpHandshakeRetry<T>(
  operation: (attempt: 1 | 2) => Promise<T>,
  options: {
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
    canRetry?: () => boolean;
  } = {},
): Promise<T> {
  const now = options.now || Date.now;
  const wait = options.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();

  try {
    return await operation(1);
  } catch (error) {
    if (
      !isSmtpProtocolVersionHandshakeAlert(error)
      || now() - started > MAX_FIRST_HANDSHAKE_MS
      || (options.canRetry && !options.canRetry())
    ) {
      throw error;
    }
    await wait(RETRY_DELAY_MS);
    return await operation(2);
  }
}

export const verifySmtpWithHandshakeRetry = withSmtpHandshakeRetry;
