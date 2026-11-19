/** Public presentation context only. Never use it for account or billing rights. */
export const BASIC_NAVIGATION_ENTRY = "basique";
export const BASIC_RESET_PRESENTATION_ROUTES = Object.freeze({
  "/reset-basique-fr": "fr", "/reset-basique-en": "en", "/reset-basique-es": "es",
  "/reset-basique-it": "it", "/reset-basique-de": "de", "/reset-basique-nl": "nl",
  "/reset-basique-pt": "pt", "/reset-basique-th": "th", "/reset-basique-zh": "zh",
} as const);
export const BASIC_NAVIGATION_LINKS = Object.freeze({
  signup: "https://inrcy.com/basique/inscription/",
  contact: "https://inrcy.com/basique/contact/",
  terms: "https://inrcy.com/basique/conditions/",
  privacy: "https://inrcy.com/basique/confidentialite/",
});

export function isBasicNavigation(entry: unknown, pathname = ""): boolean {
  return entry === BASIC_NAVIGATION_ENTRY || pathname === "/activer-mon-compte"
    || basicResetPresentationLanguage(pathname) !== null;
}

export function basicResetPresentationLanguage(pathname: string): string | null {
  return Object.hasOwn(BASIC_RESET_PRESENTATION_ROUTES, pathname)
    ? BASIC_RESET_PRESENTATION_ROUTES[pathname as keyof typeof BASIC_RESET_PRESENTATION_ROUTES] : null;
}

export function basicResetPresentationPath(language: string): string {
  return Object.entries(BASIC_RESET_PRESENTATION_ROUTES).find(([, value]) => value === language)?.[0] ?? "/reset-basique-fr";
}

/** Fixed internal links retain their existing query/hash; no redirect target is accepted. */
export function withBasicNavigation(href: string, basic: boolean): string {
  if (!basic) return href;
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) throw new Error("navigation_path_invalid");
  const url = new URL(href, "https://navigation.invalid");
  url.searchParams.set("entry", BASIC_NAVIGATION_ENTRY);
  return `${url.pathname}${url.search}${url.hash}`;
}
