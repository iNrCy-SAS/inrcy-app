"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

export function useReferralForm() {
  const t = useTranslations("shell");
  const [referralName, setReferralName] = useState("");
  const [referralPhone, setReferralPhone] = useState("");
  const [referralEmail, setReferralEmail] = useState("");
  const [referralFrom, setReferralFrom] = useState("");
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralNotice, setReferralNotice] = useState<string | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);

  const submitReferral = useCallback(async () => {
    const name = referralName.trim();
    const phone = referralPhone.trim();
    const email = referralEmail.trim();
    const from = referralFrom.trim();

    if (!name || !phone || !email || !from) {
      setReferralError(t("referral_required_fields"));
      return;
    }

    setReferralSubmitting(true);
    setReferralError(null);
    setReferralNotice(null);

    try {
      const res = await fetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, phone, email, from }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(await getSimpleFrenchApiError(res));
      }
      setReferralNotice(t("referral_sent_notice"));
      setReferralName("");
      setReferralPhone("");
      setReferralEmail("");
      setReferralFrom("");
    } catch (e: unknown) {
      setReferralError(getSimpleFrenchErrorMessage(e, t("referral_send_failed")));
    } finally {
      setReferralSubmitting(false);
    }
  }, [referralEmail, referralFrom, referralName, referralPhone, t]);

  return {
    referralName,
    referralPhone,
    referralEmail,
    referralFrom,
    referralSubmitting,
    referralNotice,
    referralError,
    setReferralName,
    setReferralPhone,
    setReferralEmail,
    setReferralFrom,
    submitReferral,
  };
}
