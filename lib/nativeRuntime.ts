export type NativePlatform = "web" | "ios" | "android";

export type NativeRuntimeLike = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

const allowedInternalPrefixes = [
  "/auth/",
  "/compte-bloque",
  "/dashboard",
  "/login",
  "/set-password",
];

export function detectNativePlatform(runtime: NativeRuntimeLike | null | undefined): NativePlatform {
  if (!runtime?.isNativePlatform?.()) return "web";

  const platform = String(runtime.getPlatform?.() || "").trim().toLowerCase();
  if (platform === "ios") return "ios";
  if (platform === "android") return "android";
  return "web";
}

function isAllowedInternalPath(pathname: string) {
  return allowedInternalPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/**
 * Converts an app/universal link into a same-origin path. External links are
 * deliberately rejected so a notification or malformed deep link cannot turn
 * the native shell into an unrestricted browser.
 */
export function normalizeNativeOpenUrl(rawUrl: string, currentOrigin: string): string | null {
  const value = String(rawUrl || "").trim();
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  let pathname = parsed.pathname || "/";
  if (parsed.protocol === "inrcy:" || parsed.protocol === "com.inrcy.app:") {
    pathname = `/${parsed.host}${parsed.pathname}`.replace(/\/+/g, "/");
  } else {
    let origin: URL;
    try {
      origin = new URL(currentOrigin);
    } catch {
      return null;
    }
    if (parsed.origin !== origin.origin) return null;
  }

  if (!isAllowedInternalPath(pathname)) return null;
  return `${pathname}${parsed.search}${parsed.hash}`;
}
