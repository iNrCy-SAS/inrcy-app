import type { APP_LOCALES } from "./config";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof APP_LOCALES)[number];
    // Exact catalogue-key unions become prohibitively large once the complete
    // application is translated. The dedicated i18n audit validates keys,
    // locales and ICU variables without inflating every TypeScript build.
    // `any` is intentional here: the catalogue validator provides the strict
    // runtime/key check without generating a multi-megabyte TypeScript union.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Messages: Record<string, any>;
  }
}
