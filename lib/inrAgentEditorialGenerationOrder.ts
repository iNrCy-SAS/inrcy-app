type EditorialGenerationAccount = {
  automation: { lastPreparedAt?: string | null };
  lastAttemptAt?: string | null;
};

/** Advance a full generation window on each visit to this account page. */
export function inrAgentEditorialGenerationRotationOffset(args: {
  tick: number;
  pageCount: number;
  accountCount: number;
  maxGenerations: number;
}) {
  if (args.accountCount <= 0) return 0;
  const pageCount = Math.max(1, Math.floor(args.pageCount));
  const pageVisit = Math.floor(args.tick / pageCount);
  return (pageVisit * args.maxGenerations) % args.accountCount;
}

function lastServiceAt(account: EditorialGenerationAccount) {
  const prepared = Date.parse(account.automation.lastPreparedAt || "");
  const attempted = Date.parse(account.lastAttemptAt || "");
  return Math.max(Number.isFinite(prepared) ? prepared : 0, Number.isFinite(attempted) ? attempted : 0);
}

/** Failed attempts also yield their turn; retries must not starve untouched work. */
export function orderInrAgentEditorialGenerationAccounts<T extends EditorialGenerationAccount>(
  accounts: readonly T[],
  rotationOffset: number,
): T[] {
  return [...accounts.slice(rotationOffset), ...accounts.slice(0, rotationOffset)]
    .map((account, tieOrder) => ({ account, tieOrder, servicedAt: lastServiceAt(account) }))
    .sort((left, right) => left.servicedAt - right.servicedAt || left.tieOrder - right.tieOrder)
    .map(({ account }) => account);
}
