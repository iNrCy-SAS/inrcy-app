import {
  buildSignupFailureMail,
  createSignupFailureFingerprint,
  type SignupFailureAlertInput,
} from "./signupFailureAlertPolicy.ts";

export type SignupFailureAlertClaim = {
  key: string;
  remote: boolean;
  token: string;
};

export type SignupFailureAlertClaimDecision =
  | { status: "acquired"; claim: SignupFailureAlertClaim }
  | { status: "sent" }
  | { status: "pending" };

export type SignupFailureAlertDeliveryDependencies = {
  destination: string;
  claim: (fingerprint: string) => Promise<SignupFailureAlertClaimDecision>;
  commit: (claim: SignupFailureAlertClaim) => Promise<void>;
  release: (claim: SignupFailureAlertClaim) => Promise<void>;
  sendMail: (mail: { to: string; subject: string; text: string; html: string }) => Promise<void>;
};

export async function deliverSignupFailureAlert(
  input: SignupFailureAlertInput,
  dependencies: SignupFailureAlertDeliveryDependencies,
) {
  const destination = String(dependencies.destination || "").trim();
  if (!destination) throw new Error("signup_failure_alert_destination_missing");

  const fingerprint = createSignupFailureFingerprint(input);
  const decision = await dependencies.claim(fingerprint);
  if (decision.status === "sent") {
    return { sent: false, deduplicated: true, inFlight: false } as const;
  }
  if (decision.status === "pending") {
    return { sent: false, deduplicated: false, inFlight: true } as const;
  }
  const claim = decision.claim;

  try {
    const mail = buildSignupFailureMail(input);
    await dependencies.sendMail({
      to: destination,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    await dependencies.commit(claim);
    return { sent: true, deduplicated: false, inFlight: false } as const;
  } catch (error) {
    await dependencies.release(claim);
    throw error;
  }
}
