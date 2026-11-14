import 'server-only';

import { ADMIN_USER_IDS, isAdminRole } from '@/lib/roles';

export type InrAgentAdminRoleClient = {
  from(table: 'profiles'): {
    select(columns: 'role'): {
      eq(column: 'user_id', value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error?: unknown }>;
      };
    };
  };
};

/** Same admin definition as getMyRole and the active-account dashboard gate.
 * Read the current profile on every call; an edition, membership role or JWT
 * metadata never grants these options. The existing explicit allow-list stays
 * authoritative even when its profile role is absent, as it does in getMyRole.
 */
export async function isInrAgentAdminAccount(
  supabase: InrAgentAdminRoleClient,
  accountId: string,
): Promise<boolean> {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!id) return false;
  if (ADMIN_USER_IDS.some(adminId => adminId === id)) return true;

  try {
    const { data, error } = await supabase.from('profiles').select('role').eq('user_id', id).maybeSingle();
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return false;
    const role = (data as { role?: unknown }).role;
    return typeof role === 'string' && isAdminRole(role);
  } catch {
    return false;
  }
}

/** Call only after requireUser resolved the active-account membership, or after
 * the cron request was authenticated. Never pass IDs or isCron from a payload.
 * API requests require both the real actor and active account to be admin.
 * Cron has no human actor: recheck its target account, ignoring synthetic IDs.
 */
export async function canUseInrAgentAdminOptions(
  supabase: InrAgentAdminRoleClient,
  options: {
    accountId: string;
    actorAuthUserId?: string | null;
    isCron?: boolean;
  },
): Promise<boolean> {
  const accountId = typeof options.accountId === 'string' ? options.accountId.trim() : '';
  if (!accountId) return false;
  if (options.isCron === true) return isInrAgentAdminAccount(supabase, accountId);

  const actorId = typeof options.actorAuthUserId === 'string' ? options.actorAuthUserId.trim() : '';
  if (!actorId) return false;
  if (actorId === accountId) return isInrAgentAdminAccount(supabase, accountId);

  const [actorIsAdmin, accountIsAdmin] = await Promise.all([
    isInrAgentAdminAccount(supabase, actorId),
    isInrAgentAdminAccount(supabase, accountId),
  ]);
  return actorIsAdmin && accountIsAdmin;
}
