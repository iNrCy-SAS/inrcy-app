import { NextRequest } from "next/server";
import { createInrBadgeQrMatrix } from "@/lib/inrBadgeQr";
import { extractInrBadgeUserIdFromSlug } from "@/lib/inrBadge";
import { directoryBadgeQrTarget } from "@/lib/inrDirectoryPublic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,100}$/.test(slug) || !extractInrBadgeUserIdFromSlug(slug)) return new Response("Badge inconnu", { status: 404 });
  const origin = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname) ? request.nextUrl.origin : undefined;
  const matrix = createInrBadgeQrMatrix(directoryBadgeQrTarget(slug, origin));
  const size = matrix.length + 8;
  const path = matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#101a38"/></svg>`;
  return new Response(svg, { headers: {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    // The public directory on inrcy.com embeds this image from app.inrcy.com.
    // Override the app's private-asset default only for this public SVG response.
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
