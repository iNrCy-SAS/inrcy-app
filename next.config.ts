import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Sharp 0.35 keeps its native addon and libvips runtime in sibling @img
// packages. Turbopack can trace the addon without retaining the shared
// libvips library in a Vercel function, which only fails once the route runs.
// Keep the includes limited to server routes that can process an image.
const sharpRuntimeFiles = [
  "node_modules/sharp/**/*",
  "node_modules/@img/**/*",
];

// Transactional emails load these images from Outlook/Gmail origins. The
// application-wide same-origin resource policy is correct for private app
// assets, but it must not be sent for explicitly public email branding.
const publicEmailAssetHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=15552000; includeSubDomains; preload",
  },
];

// Content Security Policy (CSP)
const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "connect-src 'self' https: wss:",
  "report-uri /api/csp-report",
  "report-to csp",
].join("; ");

const nextConfig: NextConfig = {
  // Aide de validation locale uniquement : le projet de contrôle utilise une
  // jonction Windows vers un cache de dépendances situé dans le dossier parent.
  // Sans la variable explicite, notamment sur Vercel, la configuration reste
  // strictement identique à celle de production.
  ...(process.env.INRCY_LOCAL_TURBOPACK_ROOT === "parent"
    ? { turbopack: { root: path.resolve(process.cwd(), "..") } }
    : {}),
  // Évite qu'un client encore ouvert mélange les assets/actions d'un ancien
  // déploiement avec le nouveau. Vercel fournit le SHA au moment du build ;
  // NEXT_DEPLOYMENT_ID peut être défini explicitement pour un autre hébergeur.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
  // heic-convert charge son décodeur WASM avec un require dynamique prévu pour
  // Node.js. Le conserver comme paquet serveur évite à webpack de parcourir le
  // bundle libheif (et son faux avertissement "Critical dependency") tout en
  // laissant le traceur Vercel embarquer le paquet et ses dépendances runtime.
  serverExternalPackages: ["heic-convert"],
  outputFileTracingIncludes: {
    "/api/cron/*": sharpRuntimeFiles,
    "/api/agent/**/*": sharpRuntimeFiles,
    "/api/booster/**/*": sharpRuntimeFiles,
    "/api/media-pipeline/**/*": sharpRuntimeFiles,
    "/api/media-library/**/*": sharpRuntimeFiles,
    "/api/media/tiktok": sharpRuntimeFiles,
    "/api/admin/image-bank/upload": sharpRuntimeFiles,
    "/api/inrsend/**/*": sharpRuntimeFiles,
  },
  ...(process.env.INR_SEARCH_LOCAL_PREVIEW === "1"
    ? { experimental: { workerThreads: true } }
    : {}),
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors *",
          },
          { key: "Cache-Control", value: "no-store" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains; preload",
          },
        ],
      },
      {
        source: "/widgets/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains; preload",
          },
        ],
      },
      {
        source: "/signature-client.png",
        headers: publicEmailAssetHeaders,
      },
      {
        source: "/email/:path*",
        headers: publicEmailAssetHeaders,
      },
      {
        source: "/entreprises/:path*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=86400" },
          { key: "Content-Language", value: "fr" },
        ],
      },
      {
        source: "/metiers/:path*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=86400" },
          { key: "Content-Language", value: "fr" },
        ],
      },
      {
        source: "/secteurs/:path*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=86400" },
          { key: "Content-Language", value: "fr" },
        ],
      },
      {
        source: "/((?!widgets/|embed/|email/|signature-client\\.png$).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), bluetooth=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Reporting-Endpoints", value: 'csp="/api/csp-report"' },
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: "inrcy",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
