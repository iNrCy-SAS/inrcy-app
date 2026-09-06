import { NextResponse } from "next/server";

const DEFAULT_ALLOWED_ORIGINS = ["https://inrcy.com", "https://www.inrcy.com"];

function configuredOrigins() {
  const extras = String(process.env.INRCY_VISIO_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...extras]);
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://localhost:8080");
  }
  return origins;
}

export function getVisioCorsOrigin(request: Request) {
  const origin = String(request.headers.get("origin") || "").trim();
  if (!origin) return null;
  return configuredOrigins().has(origin) ? origin : "";
}

export function withVisioCors(response: NextResponse, request: Request) {
  const origin = getVisioCorsOrigin(request);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", "600");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function rejectUntrustedVisioOrigin(request: Request) {
  return getVisioCorsOrigin(request) === "";
}

export function visioOptions(request: Request) {
  if (rejectUntrustedVisioOrigin(request)) {
    return withVisioCors(
      NextResponse.json({ ok: false, error: "Origine non autorisée." }, { status: 403 }),
      request,
    );
  }
  return withVisioCors(new NextResponse(null, { status: 204 }), request);
}
