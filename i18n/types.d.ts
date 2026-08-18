import type { APP_LOCALES } from "./config";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof APP_LOCALES)[number];
    // Exact catalogue-key unions become prohibitively large once the complete
    // application is translated. The dedicated i18n audit validates keys,
    // locales and ICU variables without inflating every TypeScript build.
    Messages: Record<string, any>;
  }
}
