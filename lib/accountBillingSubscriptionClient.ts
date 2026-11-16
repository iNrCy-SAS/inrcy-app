import { resolveActiveBrowserUserId } from "./browserAccountCache.ts";

/** Read the approved contract for the currently selected establishment. */
export async function readCurrentAccountSubscription<T>(authUserId: string): Promise<T | null> {
  const expectedAccountId = resolveActiveBrowserUserId(authUserId);
  const response = await fetch("/api/billing/account-subscription",{cache:"no-store"});
  const body = await response.json().catch(() => null) as {ok?:boolean;accountId?:string;subscription?:T|null} | null;
  if (!response.ok || !body?.ok) throw new Error("ACCOUNT_SUBSCRIPTION_READ_UNAVAILABLE");
  if (body.accountId !== expectedAccountId || resolveActiveBrowserUserId(authUserId) !== expectedAccountId) throw new Error("ACCOUNT_SUBSCRIPTION_SCOPE_CHANGED");
  return body.subscription || null;
}
