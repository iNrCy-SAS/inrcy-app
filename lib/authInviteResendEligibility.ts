type AuthInviteUser = {
  id?: string;
  email?: string | null;
  invited_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type AuthUsersPage = {
  data: { users: AuthInviteUser[] } | null;
  error: unknown;
};

type ListAuthUsers = (params: { page: number; perPage: number }) => Promise<AuthUsersPage>;
type GetAuthUser = (userId: string) => Promise<{
  data: { user: AuthInviteUser | null } | null;
  error: unknown;
}>;

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

/**
 * A signup can stop after Auth creates the invite but before profiles and
 * subscriptions are provisioned. This marker recovers those Auth-only invites.
 */
export function isInrcyAuthInvite(user: AuthInviteUser, email: string) {
  if (normalizeEmail(user.email) !== normalizeEmail(email)) return false;
  if (!user.invited_at) return false;

  const metadata = user.user_metadata || {};
  return typeof metadata.app_language === "string" || typeof metadata.app_locale === "string";
}

/**
 * Supabase's supported Admin lookup is paginated and has no email filter.
 * For a known account, check its Auth user by ID so a contact email cannot
 * accidentally create another user. Only profile-less invites need a scan.
 */
export async function hasEligibleInrcyAuthUser(
  email: string,
  knownUserIds: string[],
  getUserById: GetAuthUser,
  listUsers: ListAuthUsers,
) {
  const target = normalizeEmail(email);
  if (!target) return null;

  if (knownUserIds.length > 0) {
    for (const userId of knownUserIds) {
      const result = await getUserById(userId);
      if (result.error) {
        const code = String((result.error as { code?: unknown }).code || "");
        if (code === "user_not_found") continue;
        throw result.error;
      }
      if (normalizeEmail(result.data?.user?.email) === target) return result.data?.user || null;
    }
    // Another account can use this address as a contact email while the
    // invited owner's profile has not yet been provisioned. Check Auth too.
  }

  const perPage = 1_000;
  const firstIds = new Set<string>();
  for (let page = 1; page <= 50; page += 1) {
    const result = await listUsers({ page, perPage });
    if (result.error) throw result.error;

    const users = result.data?.users;
    if (!Array.isArray(users)) throw new Error("auth_invite_lookup_unavailable");
    if (users.length === 0) return null;

    const firstId = users[0]?.id;
    if (firstId && firstIds.has(firstId)) throw new Error("auth_invite_lookup_pagination_stalled");
    if (firstId) firstIds.add(firstId);

    const exactMatch = users.find((user) => normalizeEmail(user.email) === target);
    if (exactMatch) return isInrcyAuthInvite(exactMatch, target) ? exactMatch : null;
  }

  // A partial search is a provider failure, never a false "mail sent" success.
  throw new Error("auth_invite_lookup_incomplete");
}
