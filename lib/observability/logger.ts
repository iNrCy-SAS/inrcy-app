type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  request_id?: string;
  route?: string;
  method?: string;
  status_code?: number;
  duration_ms?: number;
  user_id?: string;
  provider?: string;
  integration_id?: string;
  ip?: string;
  [k: string]: unknown;
};

function sanitizeContext(ctx: LogContext): LogContext {
  const out: LogContext = {};
  const deny = /(token|password|secret|cookie|authorization|refresh|access)/i;

  for (const [k, v] of Object.entries(ctx || {})) {
    if (deny.test(k)) continue;
    // Avoid accidentally logging whole request/response objects.
    if (k === "req" || k === "request" || k === "res" || k === "response") continue;
    out[k] = v;
  }

  return out;
}

function emit(level: LogLevel, msg: string, ctx: LogContext = {}) {
  // IMPORTANT: never log secrets (tokens, passwords, cookies).
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...sanitizeContext(ctx),
  };

  // Vercel indexes the native console method as the log severity. Keeping every
  // payload on console.log made real provider failures invisible in Error/Warning.
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
};
