"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getLocalizedErrorMessage } from "@/lib/userFacingErrors";
import { adsPublicErrorMessage } from "./adsPublicErrorMessages";

/** Keep provider diagnostics internal and retain structured status/quota context. */
export function useAdsErrorMessage() {
  const locale = useLocale();
  const translate = useTranslations();
  const context = useRef({ locale, translate });
  useLayoutEffect(() => { context.current = { locale, translate }; }, [locale, translate]);
  // A language change updates copy without restarting connection/resource effects.
  return useCallback((input: unknown, fallbackKey: string, values?: Record<string, string | number>) => {
    const current = context.current;
    const publicCopy = adsPublicErrorMessage(input);
    const fallback = publicCopy ? current.translate(publicCopy.key, publicCopy.values) : current.translate(fallbackKey, values);
    // A reviewed application sentence is already the precise public guidance.
    // Only explicit machine context may override it; raw provider text remains
    // subject to the strict public classifier when no exact binding exists.
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const classificationInput = { code: record.error_code || record.code || record.errorCode || nested.error_code || nested.code || nested.errorCode, status: record.status };
    const generic = getLocalizedErrorMessage(null, current.locale, undefined, { allowUnknownMessage: false });
    const classified = getLocalizedErrorMessage(classificationInput, current.locale, generic, { allowUnknownMessage: false });
    if (classified !== generic) return classified;
    // A catalogue binding is trusted copy, not a caller/provider fallback.
    // Keep required product terms such as an Advertiser API key readable.
    if (publicCopy) return fallback;
    return getLocalizedErrorMessage(input, current.locale, fallback, { allowUnknownMessage: false });
  }, []);
}
