import { NextResponse } from "next/server";
import { buildUserFacingErrorBody } from "@/lib/apiUserFacingErrors";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { resolveWidgetUserIdFromDomain, normalizeWidgetDomain } from "@/lib/widgets/domainRegistry";

export const runtime = "nodejs";

function corsHeaders(req?: Request) {
  const origin = req?.headers.get("origin") || "";
  return {
    // We set this dynamically *after* verifying the widget token and origin.
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-InrCy-Widget-Token",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

type WidgetTokenPayload = {
  v: 1;
  domain: string;
  source: string;
  iat: number;
  exp: number;
};

function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecodeToBuffer(s: string) {
  const pad = s.length % 4;
  const base64 = (s + (pad ? "=".repeat(4 - pad) : ""))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

function verifyWidgetToken(token: string, secret: string): WidgetTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Le lien d'accès est invalide.");
  const [body, sig] = parts;

  const expected = b64urlEncode(crypto.createHmac("sha256", secret).update(body).digest());
  // Constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Le lien d'accès est invalide.");
  }

  const payload = JSON.parse(b64urlDecodeToBuffer(body).toString("utf8")) as WidgetTokenPayload;
  if (!payload || payload.v !== 1) throw new Error("Le lien d'accès est invalide.");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error("Le lien ou l'accès a expiré. Merci de recommencer.");
  return payload;
}

function originHost(req: Request): string {
  const origin = req.headers.get("origin") || "";
  if (origin) {
    try {
      return new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      // ignore
    }
  }
  const ref = req.headers.get("referer") || "";
  if (ref) {
    try {
      return new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      // ignore
    }
  }
  return "";
}

function allowedCorsOrigin(req: Request, expectedDomain: string): string | null {
  const origin = req.headers.get("origin") || "";
  if (!origin) return null;
  try {
    const u = new URL(origin);
    const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
    const dom = expectedDomain.toLowerCase().replace(/^www\./, "");
    if (host !== dom) return null;
    return origin;
  } catch {
    return null;
  }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Configuration Supabase incomplète côté serveur."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const domain = normalizeWidgetDomain(searchParams.get("domain"));
    const source = (searchParams.get("source") || "site_web").trim(); // "inrcy_site" | "site_web"
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "5", 10) || 5, 1),
      20
    );

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Le domaine du site est manquant." },
        { status: 400, headers: corsHeaders(req) }
      );
    }

    // ✅ Production-grade widget security (copy/paste-proof):
    // - Dashboard issues a SIGNED token bound to a specific domain + source.
    // - Endpoint verifies signature AND that browser Origin matches that domain.
    // - Copy/paste of the widget snippet to another domain stops working.
    const signingSecret = process.env.INRCY_WIDGETS_SIGNING_SECRET;
    if (!signingSecret) {
      throw new Error(
        "Missing INRCY_WIDGETS_SIGNING_SECRET (required for widgets security)"
      );
    }

    const providedToken =
      searchParams.get("token") || req.headers.get("x-inrcy-widget-token") || "";
    if (!providedToken) {
      return NextResponse.json(
        { ok: false, error: "Le lien d'accès est incomplet ou invalide." },
        { status: 401, headers: corsHeaders(req) }
      );
    }

    const tok = verifyWidgetToken(providedToken, signingSecret);
    const tokDomain = normalizeWidgetDomain(tok.domain);
    const tokSource = String(tok.source || "").trim();
    if (!tokDomain || tokDomain !== domain) {
      return NextResponse.json(
        { ok: false, error: "Le jeton ne correspond pas au domaine." },
        { status: 403, headers: corsHeaders(req) }
      );
    }
    if (!tokSource || tokSource !== source) {
      return NextResponse.json(
        { ok: false, error: "Le jeton ne correspond pas à cette source." },
        { status: 403, headers: corsHeaders(req) }
      );
    }

    // Origin hard-binding: request must come from the same domain as the token.
    const host = originHost(req);
    if (!host || host !== tokDomain) {
      return NextResponse.json(
        { ok: false, error: "Origine non autorisée." },
        { status: 403, headers: corsHeaders(req) }
      );
    }

    const allowOrigin = allowedCorsOrigin(req, tokDomain);
    const headersOk = {
      ...corsHeaders(req),
      "Access-Control-Allow-Origin": allowOrigin || "null",
    };

    // Distributed rate limiting (Upstash), safe across serverless instances.
    const ip = getClientIp(req);
    const rateLimited = await enforceRateLimit({
      name: "widgets_actus_public",
      identifier: `${ip}:${domain}:${source}`,
      limit: 120,
      window: "5 m",
    });
    if (rateLimited) {
      Object.entries(headersOk).forEach(([k, v]) => rateLimited.headers.set(k, v));
      return rateLimited;
    }

    const supabase = getSupabaseAdmin();

    // Resolve widget owner via indexed registry first, then durable fallback.
    const userId = await resolveWidgetUserIdFromDomain(domain, source as "inrcy_site" | "site_web");

    if (!userId) {
      return NextResponse.json(
        { ok: true, domain, user_id: null, articles: [] },
        { status: 200, headers: headersOk }
      );
    }

    // 2) Fetch articles
    const { data: articles, error: artErr } = await supabase
      .from("site_articles")
      .select("id, created_at, title, content, cta, images, media_type, video_url, video_path, video_mime, video_size, video_duration_seconds, video_thumbnail_url, media_metadata")
      .eq("user_id", userId)
      .eq("source", source)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (artErr) throw artErr;

    return NextResponse.json(
      { ok: true, domain, user_id: userId, articles: articles || [] },
      { status: 200, headers: headersOk }
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, ...buildUserFacingErrorBody(e, { status: 500, fallback: "Impossible de charger les actualités pour le moment." }) },
      { status: 500, headers: corsHeaders(req) }
    );
  }
}
