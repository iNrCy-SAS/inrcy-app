import { isTxSmtpAuthenticationFailure, isTxSmtpCircuitOpenError } from "@/lib/txSmtpCircuit";

type MailFailureContext = {
  operation: "trial_reminder" | "annual_renewal_reminder" | "admin_trial_followup";
  userId: string;
};

/** Deferred reminders remain pending; a known SMTP outage is not a new error per customer. */
export function createBillingMailFailureTracker(report: (error: unknown, context: MailFailureContext) => void) {
  let failures = 0;
  let deferred = 0;
  let smtpAuthBlocked = false;
  let authFailureReported = false;
  return {
    record(error: unknown, context: MailFailureContext) {
      failures++;
      if (isTxSmtpCircuitOpenError(error)) {
        deferred++;
        smtpAuthBlocked = true;
        return;
      }
      if (isTxSmtpAuthenticationFailure(error)) {
        smtpAuthBlocked = true;
        if (authFailureReported) return;
        authFailureReported = true;
      }
      report(error, context);
    },
    summary() {
      return { mail_failures: failures, mail_deferred: deferred, smtp_auth_blocked: smtpAuthBlocked, degraded: failures > 0 };
    },
  };
}
