export const ACTUS_WIDGET_EMBED_PATH = "/embed/actus";

const DEFAULT_PUBLIC_APP_ORIGIN = "https://app.inrcy.com";

export function resolvePublicAppOrigin(configuredOrigin?: string | null): string {
  try {
    const url = new URL(configuredOrigin || DEFAULT_PUBLIC_APP_ORIGIN);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_PUBLIC_APP_ORIGIN;
    }
    return url.origin;
  } catch {
    return DEFAULT_PUBLIC_APP_ORIGIN;
  }
}

export function createActusWidgetEmbedUrl(publicAppOrigin: string): URL {
  return new URL(ACTUS_WIDGET_EMBED_PATH, `${resolvePublicAppOrigin(publicAppOrigin)}/`);
}

export function isPublicEmbedPath(pathname: string): boolean {
  return pathname === ACTUS_WIDGET_EMBED_PATH || pathname.startsWith(`${ACTUS_WIDGET_EMBED_PATH}/`);
}

export function isActusWidgetEmbedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname === ACTUS_WIDGET_EMBED_PATH
    );
  } catch {
    return false;
  }
}
