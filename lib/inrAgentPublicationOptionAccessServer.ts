import 'server-only';

import { canUseInrAgentAdminOptions, type InrAgentAdminRoleClient } from '@/lib/inrAgentAdminOptionsServer';
import { inrAgentPublishUsesRestrictedOptions, isInrAgentPublicationSettingAllowed } from '@/lib/inrAgentAdminPublishPolicy';

type Identity = { accountId: string; actorAuthUserId?: string | null; isCron?: boolean };
export type InrAgentPublicationOptionClient = InrAgentAdminRoleClient & {
  rpc(name: 'inrcy_inr_agent_publication_plan_rights', args: { p_user_id: string }): PromiseLike<{
    data: unknown; error: unknown;
  }>;
};

/** The caller authenticates membership or the cron. Billing belongs to the active account. */
export async function resolveInrAgentPublicationOptionAccess(client: InrAgentPublicationOptionClient, identity: Identity) {
  const denied = { highFrequency: false, automaticPublish: false };
  if (!identity.accountId || (identity.isCron !== true && !identity.actorAuthUserId)) return { ...denied, adminOverride: false };
  const [adminOverride, plan] = await Promise.all([
    canUseInrAgentAdminOptions(client, identity),
    client.rpc('inrcy_inr_agent_publication_plan_rights', { p_user_id: identity.accountId }),
  ]);
  if (adminOverride) return { highFrequency: true, automaticPublish: true, adminOverride };
  const row = Array.isArray(plan.data) ? plan.data[0] : null;
  if (plan.error || typeof row?.can_use_high_frequency !== 'boolean' || typeof row?.can_publish_without_validation !== 'boolean') {
    throw new Error('Les droits de publication du compte sont temporairement indisponibles.');
  }
  return { highFrequency: row.can_use_high_frequency === true, automaticPublish: row.can_publish_without_validation === true, adminOverride };
}

export async function canUseInrAgentPublicationSettings(client: InrAgentPublicationOptionClient, identity: Identity, automation: { frequency?: unknown; validationMode?: unknown }) {
  if (!inrAgentPublishUsesRestrictedOptions(automation)) return true;
  return isInrAgentPublicationSettingAllowed(automation, await resolveInrAgentPublicationOptionAccess(client, identity));
}
