type EditorialGenerationAccount = {
  automation: { lastPreparedAt?: string | null };
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

function lastPreparedAt(account: EditorialGenerationAccount) {
  const parsed = Date.parse(account.automation.lastPreparedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Successful preparation moves an account behind older work; ties rotate. */
export function orderInrAgentEditorialGenerationAccounts<T extends EditorialGenerationAccount>(
  accounts: readonly T[],
  rotationOffset: number,
): T[] {
  return [...accounts.slice(rotationOffset), ...accounts.slice(0, rotationOffset)]
    .map((account, tieOrder) => ({ account, tieOrder, preparedAt: lastPreparedAt(account) }))
    .sort((left, right) => left.preparedAt - right.preparedAt || left.tieOrder - right.tieOrder)
    .map(({ account }) => account);
}
