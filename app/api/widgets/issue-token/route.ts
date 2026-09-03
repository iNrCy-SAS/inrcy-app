import { NextResponse } from "next/server";
import { buildUserFacingErrorBody } from "@/lib/apiUserFacingErrors";
import crypto from "crypto";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { withApi } from "@/lib/observability/withApi";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { asRecord } from "@/lib/tsSafe";

export const runtime = "nodejs";

type PayloadV1 = {
  v: 1;
  domain: string;
  source: string;
  iat: number;
  exp: number;
};

function b64urlEncode(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeDomain(input: string | null): string {
  if (!input) return "";
  let raw = input.trim();
  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const u = new URL(raw);
    return (u.hostname || "").toLowerCase().replace(/^www\./, "");
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
}

function sign(payload: PayloadV1, secret: string) {
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64urlEncode(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function originHost(_req: Request): string {
  const origin = _req.headers.get("origin") || "";
  if (origin) {
    try {
      return new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
    } catch {}
  }
  return "";
}

function requestHost(_req: Request): string {
  const forwardedHost = _req.headers.get("x-forwarded-host") || _req.headers.get("host") || "";
  const h = forwardedHost.split(",")[0]?.trim() || "";
  if (!h) return "";
  try {
    return new URL(`https://${h}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return h.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  }
}

function parseAllowedOrigins(): string[] {
  return (process.env.INRCY_WIDGET_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function corsHeaders(allowOrigin: string | null) {
  return {
    "Access-Control-Allow-Origin": allowOrigin || "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
    Vary: "Origin",
  } as Record<string, string>;
}

export async function OPTIONS(_req: Request) {
  // Preflight: we don't know the domain yet, answer with "null".
  return new NextResponse(null, { status: 204, headers: corsHeaders(null) });
}

const handler = async (_req: Request) => {
  try {
    const secret = process.env.INRCY_WIDGETS_SIGNING_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: false, error: "Configuration du widget incomplète côté serveur." }, { status: 500 });
    }

    const { searchParams } = new URL(_req.url);
    const domain = normalizeDomain(searchParams.get("domain"));
    const source = (searchParams.get("source") || "").trim();

    if (!domain) {
      return NextResponse.json({ ok: false, error: "Le domaine du site est manquant." }, { status: 400, headers: corsHeaders(null) });
    }
    if (source !== "inrcy_site" && source !== "site_web") {
      return NextResponse.json({ ok: false, error: "La source demandée n'est pas reconnue." }, { status: 400, headers: corsHeaders(null) });
    }

    // CORS hard-binding for widgets and same-origin dashboard calls.
    // - For embedded widgets: Origin must match the target domain.
    // - For the dashboard: Origin must match the request host (or be explicitly
    //   trusted through INRCY_WIDGET_ALLOWED_ORIGINS).
    const origin = _req.headers.get("origin");
    const originH = originHost(_req);
    const allowedOrigins = parseAllowedOrigins();

    // Dashboard calls are same-origin and remain protected below by the authenticated
    // account plus the ownership check for the requested domain. The env allowlist is
    // still supported for additional trusted dashboard origins.
    const sameOriginDashboardRequest = Boolean(origin && originH && originH === requestHost(_req));
    let allowOrigin: string | null = isAllowedOrigin(origin, allowedOrigins) || sameOriginDashboardRequest ? origin! : null;

    // Widget calls (Origin host matches the domain)
    if (!allowOrigin && origin && originH === domain) {
      allowOrigin = origin;
    }

    // A same-origin GET can legitimately omit Origin. It proceeds without exposing
    // a CORS origin; authentication and domain ownership below remain mandatory.
    if (!allowOrigin && origin) {
      return NextResponse.json({ ok: false, error: "Origine non autorisée." }, { status: 403, headers: corsHeaders(null) });
    }

    // Rate-limit early (IP-based) to protect against anonymous abuse.
    const ip = getClientIp(_req);
    const ipLimit = await enforceRateLimit({
      name: "widgets_issue_token_ip",
      identifier: `${ip}:${domain}:${source}`,
      limit: 120,
      window: "1 m",
    });
    if (ipLimit) {
      // ensure CORS headers are present so the browser can read the 429
      Object.entries(corsHeaders(allowOrigin)).forEach(([k, v]) => ipLimit.headers.set(k, v));
      return ipLimit;
    }

    // Must be an authenticated dashboard user.
    const supabase = await createSupabaseServer();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ ok: false, error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401, headers: corsHeaders(allowOrigin) });
    }

    const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

    // User-based limiter (protect costs + prevent a single account from hammering).
    const userLimit = await enforceRateLimit({
      name: "widgets_issue_token_user",
      identifier: `${activeUserId}:${domain}:${source}`,
      limit: 60,
      window: "1 m",
    });
    if (userLimit) {
      Object.entries(corsHeaders(allowOrigin)).forEach(([k, v]) => userLimit.headers.set(k, v));
      return userLimit;
    }

    // Extra safety: ensure the domain belongs to THIS user for this source.
    if (source === "inrcy_site") {
      const { data, error } = await supabase
        .from("inrcy_site_configs")
        .select("site_url")
        .eq("user_id", activeUserId)
        .maybeSingle();
      if (error) throw error;
      const d = normalizeDomain(String(asRecord(data)["site_url"] ?? ""));
      if (!d || d !== domain) {
        return NextResponse.json(
          { ok: false, error: "Ce domaine n'est pas rattaché à votre site iNrCy." },
          { status: 403, headers: corsHeaders(allowOrigin) }
        );
      }
    } else {
      const { data, error } = await supabase
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", activeUserId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const settings = asRecord(asRecord(data)["settings"]);
      const siteWeb = asRecord(settings["site_web"]);
      const d = normalizeDomain(String(siteWeb["url"] ?? ""));
      if (!d || d !== domain) {
        return NextResponse.json(
          { ok: false, error: "Ce domaine n'est pas rattaché à votre site web." },
          { status: 403, headers: corsHeaders(allowOrigin) }
        );
      }
    }

    const now = Math.floor(Date.now() / 1000);
    // Long-lived token (1 year). Rotation is possible by changing the signing secret.
    const payload: PayloadV1 = {
      v: 1,
      domain,
      source,
      iat: now,
      exp: now + 60 * 60 * 24 * 365,
    };

    const token = sign(payload, secret);
    return NextResponse.json({ ok: true, token, payload }, { status: 200, headers: corsHeaders(allowOrigin) });
  } catch (e: unknown) {
    // We can't reliably know the correct origin in this catch (it may have failed before parsing),
    // so keep CORS conservative.
    return NextResponse.json(
      { ok: false, ...buildUserFacingErrorBody(e, { status: 500, fallback: "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes." }) },
      { status: 500, headers: corsHeaders(null) }
    );
  }
};

export const GET = withApi(handler, { route: "/api/widgets/issue-token" });
