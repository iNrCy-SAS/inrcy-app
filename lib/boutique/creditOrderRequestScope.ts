const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Optional equality guards for an existing authenticated return. They never
 * grant an account role or authorize a payment. Legacy personal returns omit them. */
export function isExpectedCreditOrderRequestScope(request: Request, auth: { activeUserId: string; authUserId?: string }) {
  if (request.signal.aborted) return false;
  const params = new URL(request.url).searchParams, accountId = params.get("expectedAccountId"), actorUserId = params.get("expectedActorUserId");
  if (accountId === null && actorUserId === null) return true;
  return Boolean(accountId && actorUserId && UUID.test(accountId) && UUID.test(actorUserId) && accountId === auth.activeUserId && actorUserId === auth.authUserId);
}
