import type { AdsProvider } from "@/lib/adsValidation";

export function adsOAuthRedirectUri(requestUrl: string, provider: AdsProvider) {
  const explicit = provider === "meta" ? process.env.META_ADS_REDIRECT_URI : process.env.GOOGLE_ADS_REDIRECT_URI;
  return explicit || `${new URL(requestUrl).origin}/api/ads/oauth/${provider}/callback`;
}

export function adsOAuthProvider(value: unknown): AdsProvider | null {
  return value === "meta" || value === "google" ? value : null;
}

export function adsReturnUrl(requestUrl: string, provider: AdsProvider, result: "connected" | "error", error?: string) {
  const url = new URL("/dashboard/ads", requestUrl);
  url.searchParams.set("channel", provider);
  url.searchParams.set("connection", result);
  if (error) url.searchParams.set("reason", error.slice(0, 150));
  return url;
}
