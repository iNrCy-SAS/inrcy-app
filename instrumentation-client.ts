// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { filterSentryEvent, scrubSentrySpan } from "@/lib/observability/sentryEventFilter";
import { installExpectedClientRejectionGuard } from "@/lib/clientExpectedErrors";

installExpectedClientRejectionGuard();

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

const tracesSampleRate = Number.parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.1");

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? Math.min(1, Math.max(0, tracesSampleRate)) : 0.1,
    beforeSendSpan(span) {
      return scrubSentrySpan(span);
    },
    beforeSendTransaction(event) {
      return filterSentryEvent(event, { scrubHeaders: true });
    },
    beforeSend(event) {
      return filterSentryEvent(event, { dropExpectedClientErrors: true });
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
