import { NextResponse } from "next/server";
import { log } from "@/lib/observability/logger";
import { getRequestId, getRequestMeta } from "@/lib/observability/request";
import { captureApiException } from "@/lib/observability/sentry";
import { getAccountDiagnosticLogContext, recordCurrentAccountDiagnosticError, runWithAccountDiagnosticContext } from "@/lib/observability/accountDiagnostics";

type Handler<Args extends [Request, ...unknown[]]> = (...args: Args) => Promise<Response>;

function withRequestIdHeader(res: Response, request_id?: string): Response {
  if (!request_id) return res;

  try {
    // In most cases, Response headers are mutable in Next route handlers.
    res.headers.set("x-request-id", request_id);
    return res;
  } catch {
    // Fallback: clone the response with a new Headers object
    const headers = new Headers(res.headers);
    headers.set("x-request-id", request_id);

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
}

export function withApi<Args extends [Request, ...unknown[]]>(
  handler: Handler<Args>,
  opts?: { route?: string },
) {
  return async function wrapped(...args: Args): Promise<Response> {
    const _req = args[0];
    const started = Date.now();
    const request_id = getRequestId(_req);
    const meta = getRequestMeta(_req);
    const route = opts?.route ?? meta.pathname;

    return runWithAccountDiagnosticContext({ route, requestId: request_id }, async () => {
      const diagnosticContext = () => getAccountDiagnosticLogContext();
      const canonicalRequestId = diagnosticContext().request_id;
      try {
        const res = await handler(...args);
        const duration_ms = Date.now() - started;
        const status_code = res.status;
        if (status_code >= 400) await recordCurrentAccountDiagnosticError(status_code);

        log.info("api_request", {
          route, method: meta.method, status_code, duration_ms, ip: meta.ip,
          ...diagnosticContext(),
        });

        return withRequestIdHeader(res, canonicalRequestId);
      } catch (error) {
        const duration_ms = Date.now() - started;
        const message = error instanceof Error ? error.message : "Unhandled exception";
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        await recordCurrentAccountDiagnosticError(500, code);

        captureApiException(_req, error, {
          route, operation: `${meta.method} ${route}`, statusCode: 500,
          requestId: canonicalRequestId,
          userId: diagnosticContext().user_id,
          accountId: diagnosticContext().account_id,
        });

        log.error("api_error", {
          route, method: meta.method, status_code: 500, duration_ms,
          ip: meta.ip, error_message: "API request failed",
          ...diagnosticContext(),
        });

        const publicError = { error: "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.", request_id: canonicalRequestId };
        const body = process.env.NODE_ENV === "production" ? publicError : { ...publicError, message };

        const out = NextResponse.json(body, { status: 500 });
        out.headers.set("x-request-id", canonicalRequestId || "");
        return out;
      }
    });
  };
}
