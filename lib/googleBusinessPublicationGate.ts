import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readGmbVerification, type GmbVerificationStatus } from "@/lib/googleBusinessVerification";
import { persistGmbVerification, readStoredGmbVerificationStatus } from "@/lib/googleBusinessVerificationStore";

type Row = Record<string, unknown>;
type BlockingStatus = "pending" | "required" | "restricted" | "unknown" | "selection_changed";
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

/** A business validation action is neither a broken OAuth grant nor an
 * uncertain POST: this guard runs before any remote publication is sent. */
export class GmbPublicationVerificationError extends Error {
  readonly status = 409;
  readonly retryable = false;
  readonly outcomeUnknown = false;
  readonly code: string;

  constructor(readonly verificationStatus: BlockingStatus) {
    const messages: Record<BlockingStatus, string> = {
      pending: "La fiche Google Business est en cours de validation. À suivre sur Google Business avant de publier.",
      required: "Google demande de valider cette fiche avant de publier. À suivre sur Google Business.",
      restricted: "Une action est requise sur cette fiche avant de publier. À suivre sur Google Business.",
      unknown: "Le statut de validation de cette fiche est indisponible. Actualisez Google Business dans Canaux avant de publier.",
      selection_changed: "La sélection Google Business a changé. Rouvrez Canaux avant de publier.",
    };
    super(messages[verificationStatus]);
    this.name = "GmbPublicationVerificationError";
    this.code = verificationStatus === "selection_changed" ? "gmb_publication_selection_changed"
      : verificationStatus === "unknown" ? "gmb_verification_unavailable" : `gmb_verification_${verificationStatus}`;
  }
}

/** Preserve a known business-validation explanation before generic connection
 * guards run. A genuine OAuth renewal or an absent target retains priority. */
export function getGmbPublicationStateBlock(stateValue: unknown): GmbPublicationVerificationError | null {
  const state = object(stateValue);
  if (state.connected !== true || state.connection_status !== "connected" || state.requiresUpdate === true || state.expired === true) return null;
  const status = state.verification_status;
  return status === "pending" || status === "required" || status === "restricted" ? new GmbPublicationVerificationError(status) : null;
}

/** One bounded eligibility check per publication attempt. Exact, recent
 * evidence is reused; the channels refresh/poll updates pending evidence after
 * Google validates the fiche. Unknown or expired evidence is checked live. */
export async function assertGmbPublicationVerification({ accessToken, row, userId, accountName, locationName, db, fetcher = fetch }: {
  accessToken: string; row: Row; userId: string; accountName: string; locationName: string;
  db?: SupabaseClient; fetcher?: typeof fetch;
}): Promise<GmbVerificationStatus> {
  const meta = object(row.meta);
  if (row.user_id !== userId || row.provider !== "google" || row.source !== "gmb" || row.product !== "gmb"
    || !["connected", "account_connected"].includes(text(row.status))
    || row.resource_id !== locationName || (text(meta.account) && meta.account !== accountName)
    || !/^locations\/[a-zA-Z0-9_-]+$/.test(locationName) || !/^accounts\/[a-zA-Z0-9_-]+$/.test(accountName)) {
    throw new GmbPublicationVerificationError("selection_changed");
  }
  const cachedStatus = readStoredGmbVerificationStatus(meta, locationName, accountName);
  if (cachedStatus === "verified") return "verified";
  if (cachedStatus === "pending" || cachedStatus === "required" || cachedStatus === "restricted") throw new GmbPublicationVerificationError(cachedStatus);

  const status = await readGmbVerification(accessToken, locationName, fetcher);
  if (db) {
    try {
      await persistGmbVerification({ db, userId, row, accountName, locationName, status });
    } catch {
      // Enrichment is best effort. Its persistence cannot authorize a POST or
      // turn a Google-side validation action into an application error.
    }
  }
  if (status === "pending" || status === "required" || status === "restricted") throw new GmbPublicationVerificationError(status);
  // iNrCy's publication policy requires confirmed validation. An unavailable
  // lookup neither proves a pending validation nor invalidates the OAuth grant.
  if (status === "unknown") throw new GmbPublicationVerificationError("unknown");
  return status;
}
