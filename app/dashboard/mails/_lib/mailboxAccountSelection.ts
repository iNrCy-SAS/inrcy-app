type MailAccountCandidate = {
  id: string;
  status: string;
  connection_status?: string;
  requires_update?: boolean;
};

/** Use the same account for the select, draft, signature and send action. */
export function resolveMailAccountSelection<T extends MailAccountCandidate>(
  accounts: readonly T[],
  requestedId: string,
): T | null {
  const requested = requestedId
    ? accounts.find((account) => account.id === requestedId)
    : undefined;
  if (requested) {
    return requested.status === "connected" && requested.connection_status !== "disconnected"
      ? requested
      : null;
  }

  const available = accounts.filter(
    (account) =>
      Boolean(account.id) &&
      account.status === "connected" &&
      account.connection_status !== "needs_update" &&
      account.connection_status !== "disconnected" &&
      !account.requires_update,
  );

  // A restored draft can precede the connection or reference its former ID.
  // Never silently choose a different sender when several accounts are ready.
  return available.length === 1 ? available[0] : null;
}
