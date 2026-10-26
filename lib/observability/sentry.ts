import * as Sentry from "@sentry/nextjs";
import { getRequestId, getRequestMeta } from "@/lib/observability/request";

export type ApiSentryContext = {
  requestId?: string;
  area?: string;
  operation?: string;
  statusCode?: number;
  userId?: string | null;
  accountId?: string | null;
  provider?: string;
  [key: string]: unknown;
};

function toError(error: unknown): Error {
  if (error instanceof Error) return error;

  if (typeof error === "string" && error.trim()) {
    return new Error(error);
  }

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown API error");
  }
}

function areaFromRoute(route: string): string {
  if (/\/booster\b|\/inrsend\b/.test(route)) return "booster";
  if (/\/fideliser\b|\/propulser\b|\/crm\b/.test(route)) return "crm_campaigns";
  if (/\/inrstats\b|\/generator\b|\/stats\b/.test(route)) return "inrstats";
  if (/\/calendar\b/.test(route)) return "inrcalendar";
  if (/\/factures\b|\/devis\b|\/documents\b/.test(route)) return "documents";
  if (/\/agent\b/.test(route)) return "inragent";
  return "api";
}

function getRequestInfo(req?: Request) {
  if (!req) return { requestId: undefined, route: "unknown", method: "unknown" };

  try {
    const meta = getRequestMeta(req);
    return {
      requestId: getRequestId(req),
      route: meta.pathname,
      method: meta.method,
    };
  } catch {
    return {
      requestId: getRequestId(req),
      route: "unknown",
      method: req.method || "unknown",
    };
  }
}

/**
 * Capture an API exception with safe, low-cardinality context.
 * Request bodies, headers, cookies, tokens and email addresses are deliberately
 * not attached here; the SDK event filter handles the remaining request data.
 */
export function captureApiException(
  req: Request | undefined,
  error: unknown,
  context: ApiSentryContext = {},
) {
  const requestInfo = getRequestInfo(req);
  if (context.requestId && /^[0-9a-f-]{36}$/i.test(context.requestId)) requestInfo.requestId = context.requestId;
  const area = String(context.area || areaFromRoute(requestInfo.route));
  const operation = String(context.operation || `${requestInfo.method} ${requestInfo.route}`);
  const normalizedError = toError(error);

  Sentry.withScope((scope) => {
    scope.setTag("source", "api");
    scope.setTag("area", area);
    scope.setTag("operation", operation);

    if (requestInfo.requestId) scope.setTag("request_id", requestInfo.requestId);
    if (context.provider) scope.setTag("provider", String(context.provider));
    if (typeof context.statusCode === "number") {
      scope.setTag("status_code", String(context.statusCode));
    }
    if (context.userId) scope.setUser({ id: String(context.userId) });

    const safeContext: Record<string, unknown> = {
      route: requestInfo.route,
      method: requestInfo.method,
      request_id: requestInfo.requestId,
      area,
      operation,
      status_code: context.statusCode,
      provider: context.provider,
    };

    if (context.accountId) safeContext.account_id = String(context.accountId);
    if (typeof normalizedError === "object" && "code" in normalizedError) {
      const code = (normalizedError as Error & { code?: unknown }).code;
      if (typeof code === "string" && code.trim()) safeContext.error_code = code;
    }

    scope.setContext("api", safeContext);
    Sentry.captureException(normalizedError);
  });
}
