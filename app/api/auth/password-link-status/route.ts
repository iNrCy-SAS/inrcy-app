import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

// Never verifyOtp here: email scanners and repeated opens must leave the link
// untouched. The service-only RPC reads the current token and its expiry only.
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ code: "invalid_origin" }, 403);

  const limited = await enforceRateLimit({
    name: "password_link_status", identifier: getClientIp(req),
    limit: 60, window: "1 m", failClosed: true,
  });
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  try {
    const raw = await req.text();
    if (raw.length > 4096) return json({ valid: false });
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ valid: false });
      body = parsed as Record<string, unknown>;
    } catch { return json({ valid: false }); }
    const mode = body.mode;
    const tokenHash = typeof body.token_hash === "string" ? body.token_hash : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
    if ((mode !== "invite" && mode !== "reset") || !/^[a-zA-Z0-9_-]{32,256}$/.test(tokenHash) ||
        (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
      return json({ valid: false });
    }

    const { data, error } = await supabaseAdmin.rpc("inrcy_password_link_status", {
      p_token_hash: tokenHash, p_mode: mode, p_email: email || null,
    }).abortSignal(AbortSignal.timeout(8000));
    if (error || !data || typeof data.valid !== "boolean") {
      return json({ code: "link_check_unavailable", retryable: true }, 503);
    }
    // No address, account id, token, or Auth session ever leaves this endpoint.
    return data.valid
      ? json({ valid: true, expires_at: data.expires_at })
      : json({ valid: false });
  } catch {
    return json({ code: "link_check_unavailable", retryable: true }, 503);
  }
}
