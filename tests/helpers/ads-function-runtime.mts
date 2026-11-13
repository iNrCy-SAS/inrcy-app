import { adsComponentModules } from "./ads-component-runtime.mts";

const modules = adsComponentModules();
const intl = modules["next-intl"];
const runtime = {
  ...intl,
  ...modules["./adsUiCopy"],
  ...modules["./adsClientHttp"],
  ...modules["./useAdsErrorMessage"],
  i18nT: intl.useTranslations("booster"),
  errorMessage: modules["./useAdsErrorMessage"].useAdsErrorMessage(),
  locale: intl.useLocale(),
};

/** Supply the actual public-copy adapters to extracted production closures.
 * Explicit harness state and network guards always override these defaults. */
export function withAdsRuntime(scope: Record<string, unknown> = {}) {
  return { ...runtime, ...scope };
}
