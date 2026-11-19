export const DIRECT_SIGNUP_METADATA_KEY = "inrcy_direct_signup_v1";
export const DIRECT_SIGNUP_ACTIVATION_PATH = "/activer-mon-compte";

export type DirectSignupMetadata = { version: 1; entry: "basique"; created_at: string };
export type DirectSignupSubscription = {
  status?: string | null; stripe_subscription_id?: string | null;
  plan?: string | null; billing_cycle?: string | null;
};

/** Server-written app metadata only; campaign parameters cannot grant access. */
export function getDirectSignupMetadata(value: unknown): DirectSignupMetadata | null {
  if (!value || typeof value !== "object") return null;
  const marker = (value as Record<string, unknown>)[DIRECT_SIGNUP_METADATA_KEY];
  if (!marker || typeof marker !== "object") return null;
  const candidate = marker as Partial<DirectSignupMetadata>;
  return candidate.version === 1 && candidate.entry === "basique"
    && typeof candidate.created_at === "string" && Number.isFinite(Date.parse(candidate.created_at))
    ? candidate as DirectSignupMetadata : null;
}

/** A Checkout URL, browser return, or trial state is never payment proof. */
export function isDirectSignupPaid(subscription: DirectSignupSubscription | null | undefined): boolean {
  return subscription?.status?.trim().toLowerCase() === "active"
    && Boolean(subscription.stripe_subscription_id?.trim());
}

export function directSignupNeedsActivation(appMetadata: unknown, subscription: DirectSignupSubscription | null | undefined): boolean {
  return Boolean(getDirectSignupMetadata(appMetadata)) && !isDirectSignupPaid(subscription);
}

const DIRECT_SIGNUP_CHECKOUT_MESSAGES = {
  fr: {
    monthly: "Sans période d’essai. Votre abonnement commence dès le paiement. En cas de résiliation, un renouvellement mensuel supplémentaire est prélevé avant la fin de l’abonnement.",
    yearly: "Sans période d’essai. Votre abonnement commence dès le paiement. En cas de résiliation, il reste actif jusqu’à la fin de la période annuelle payée, sans nouveau prélèvement.",
  },
  en: {
    monthly: "No trial period. Your subscription starts upon payment. If you cancel, one additional monthly renewal is charged before your subscription ends.",
    yearly: "No trial period. Your subscription starts upon payment. If you cancel, it stays active until the end of the paid annual period, with no further charge.",
  },
  es: {
    monthly: "Sin período de prueba. Tu suscripción comienza al pagar. Si cancelas, se cobrará una renovación mensual adicional antes de que termine la suscripción.",
    yearly: "Sin período de prueba. Tu suscripción comienza al pagar. Si cancelas, seguirá activa hasta el final del período anual pagado, sin nuevos cobros.",
  },
  it: {
    monthly: "Nessun periodo di prova. L’abbonamento inizia al pagamento. In caso di disdetta, verrà addebitato un ulteriore rinnovo mensile prima della chiusura dell’abbonamento.",
    yearly: "Nessun periodo di prova. L’abbonamento inizia al pagamento. In caso di disdetta, rimane attivo fino alla fine del periodo annuale pagato, senza ulteriori addebiti.",
  },
  de: {
    monthly: "Keine Testphase. Dein Abonnement beginnt mit der Zahlung. Bei Kündigung wird eine weitere monatliche Verlängerung berechnet, bevor das Abonnement endet.",
    yearly: "Keine Testphase. Dein Abonnement beginnt mit der Zahlung. Bei Kündigung bleibt es bis zum Ende des bezahlten Jahreszeitraums aktiv, ohne weitere Abbuchung.",
  },
  nl: {
    monthly: "Geen proefperiode. Je abonnement gaat in zodra je betaalt. Bij opzegging wordt nog één extra maandelijkse verlenging in rekening gebracht voordat je abonnement eindigt.",
    yearly: "Geen proefperiode. Je abonnement gaat in zodra je betaalt. Bij opzegging blijft het actief tot het einde van de betaalde jaarperiode, zonder nieuwe afschrijving.",
  },
  pt: {
    monthly: "Sem período de teste. A sua assinatura começa após o pagamento. Em caso de cancelamento, será cobrada uma renovação mensal adicional antes do fim da assinatura.",
    yearly: "Sem período de teste. A sua assinatura começa após o pagamento. Em caso de cancelamento, permanece ativa até ao fim do período anual pago, sem nova cobrança.",
  },
  th: {
    monthly: "ไม่มีช่วงทดลองใช้ฟรี การสมัครสมาชิกเริ่มต้นเมื่อชำระเงิน หากยกเลิก จะมีการเรียกเก็บค่าต่ออายุรายเดือนเพิ่มเติมอีกหนึ่งครั้งก่อนสิ้นสุดการสมัครสมาชิก",
    yearly: "ไม่มีช่วงทดลองใช้ฟรี การสมัครสมาชิกเริ่มต้นเมื่อชำระเงิน หากยกเลิก จะใช้งานได้จนสิ้นสุดระยะเวลารายปีที่ชำระแล้ว โดยไม่มีการเรียกเก็บเงินครั้งใหม่",
  },
  zh: {
    monthly: "无试用期。订阅自付款时开始。如取消订阅，在订阅结束前还将收取一次额外的月度续订费用。",
    yearly: "无试用期。订阅自付款时开始。如取消订阅，仍可使用至已付款年度期限结束，之后不再扣款。",
  },
} as const;

type DirectSignupCheckoutLanguage = keyof typeof DIRECT_SIGNUP_CHECKOUT_MESSAGES;

function checkoutLanguage(value: unknown): DirectSignupCheckoutLanguage | null {
  if (typeof value !== "string") return null;
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return Object.hasOwn(DIRECT_SIGNUP_CHECKOUT_MESSAGES, language) ? language as DirectSignupCheckoutLanguage : null;
}

/** Display preference only: user metadata never decides eligibility or billing terms. */
export function getDirectSignupCheckoutSubmitMessage(
  billingCycle: "monthly" | "yearly",
  userMetadata: unknown,
): string {
  const metadata = userMetadata && typeof userMetadata === "object"
    ? userMetadata as Record<string, unknown> : {};
  const language = checkoutLanguage(metadata.app_language) || checkoutLanguage(metadata.app_locale) || "fr";
  return DIRECT_SIGNUP_CHECKOUT_MESSAGES[language][billingCycle];
}
