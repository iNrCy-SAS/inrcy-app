import * as Sentry from "@sentry/nextjs";
import { installSafeAiSdkWarningLogger } from "./lib/aiSdkSafeWarnings.ts";

export async function register() {
  installSafeAiSdkWarningLogger();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
