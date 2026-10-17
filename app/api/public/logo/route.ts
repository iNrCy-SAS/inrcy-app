import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { LOGO_BUCKET } from "@/lib/profileLogo";
import { isTransientSupabaseReadError, runTransientPostgrestRead } from "@/lib/supabaseTransientRetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_LOGO_PATH = /^[0-9a-f-]{20,}\/logo\.(?:png|jpe?g|webp|svg)$/i;

function contentTypeFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "image/png";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const path = requestUrl.searchParams.get("path")?.trim().replace(/^\/+/, "") || "";
  const hasVersion = Boolean(requestUrl.searchParams.get("v"));
  if (!ALLOWED_LOGO_PATH.test(path) || path.includes("..")) {
    return NextResponse.json({ error: "Logo invalide." }, { status: 400 });
  }

  const { data, error } = await runTransientPostgrestRead(async () => {
    try {
      const result = await supabaseAdmin.storage.from(LOGO_BUCKET).download(path);
      return { ...result, status: isTransientSupabaseReadError(result.error) ? 503 : 0 };
    } catch (error) {
      if (!isTransientSupabaseReadError(error)) throw error;
      // Return a retryable result; a second failure becomes a proper 503.
      return { data: null, error, status: 503 };
    }
  });
  if (error || !data) {
    const storageError = error as { statusCode?: string | number; status?: number } | null;
    const status = Number(storageError?.statusCode || storageError?.status || 0);
    return NextResponse.json(
      { error: "Logo introuvable." },
      { status: status === 404 || status === 400 ? 404 : 503,
        headers: { "Cache-Control": "no-store", ...([400, 404].includes(status) ? {} : { "Retry-After": "3" }) } },
    );
  }

  return new NextResponse(data.stream(), {
    status: 200,
    headers: {
      "Content-Type": data.type || contentTypeFromPath(path),
      "Cache-Control": hasVersion
        ? "public, max-age=31536000, s-maxage=31536000, immutable"
        : "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...(path.toLowerCase().endsWith(".svg")
        ? { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" }
        : {}),
    },
  });
}
