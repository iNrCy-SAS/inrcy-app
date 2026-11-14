import 'server-only';

import { canUseInrAgentAdminOptions } from '@/lib/inrAgentAdminOptionsServer';
import { INR_AGENT_ADMIN_PUBLISH_MODE, inrAgentAdminMarkerMatchesOptIn, readInrAgentAdminAutomaticPublish } from '@/lib/inrAgentAdminPublishPolicy';

/** Fresh authorization at each boundary. Never accept an actor ID from job metadata. */
export async function isInrAgentAdminAutomaticPublicationAuthorized(args: {
  supabase: any;
  accountId: string;
  actorAuthUserId?: string;
  isCron: boolean;
  marker: unknown;
  sourceActionId?: string;
}): Promise<boolean> {
  try {
    if (!await canUseInrAgentAdminOptions(args.supabase, args)) return false;
    const [global, automation] = await Promise.all([
      args.supabase.from('inr_agent_settings').select('global_enabled').eq('user_id', args.accountId).maybeSingle(),
      args.supabase.from('inr_agent_automation_settings').select('enabled,validation_mode,metadata').eq('user_id', args.accountId).eq('automation_key', 'publish').maybeSingle(),
    ]);
    const authorized = !global.error && !automation.error && global.data?.global_enabled === true && automation.data?.enabled === true
      && automation.data.validation_mode === INR_AGENT_ADMIN_PUBLISH_MODE
      && inrAgentAdminMarkerMatchesOptIn(args.marker, automation.data.metadata?.adminPublishOptIn, args.accountId);
    if (!authorized || !args.sourceActionId) return authorized;
    const action = await args.supabase.from('inr_agent_actions')
      .select('automation_key,action_type,target_tool,status,validation_required,execution_policy,validated_at,payload,metadata')
      .eq('id', args.sourceActionId).eq('user_id', args.accountId).maybeSingle();
    const marker = JSON.stringify(readInrAgentAdminAutomaticPublish(args.marker));
    return !action.error && action.data?.automation_key === 'publish' && action.data.action_type === 'publication'
      && action.data.target_tool === 'booster' && ['prepared', 'executing', 'scheduled', 'failed', 'completed'].includes(action.data.status)
      && action.data.validation_required === false && action.data.execution_policy === 'automatic_after_settings' && !action.data.validated_at
      && action.data.metadata?.adminAutomaticPublishManualReview !== true
      && JSON.stringify(readInrAgentAdminAutomaticPublish(action.data.metadata?.adminAutomaticPublish)) === marker
      && JSON.stringify(readInrAgentAdminAutomaticPublish(action.data.payload?.adminAutomaticPublish)) === marker;
  } catch {
    return false;
  }
}

/** Revocation never approves old content. Retain provenance, park it for review. */
export async function parkInrAgentAdminAutomaticPublications(args: {
  supabase: any; accountId: string; optInId?: string; actionId?: string; now?: string;
}) {
  const now = args.now ?? new Date().toISOString();
  let scheduled = args.supabase.from('inr_agent_scheduled_actions').update({ status: 'cancelled',
    last_error: 'Publication automatique annulée : son autorisation administrateur n’est plus active.', updated_at: now })
    .eq('user_id', args.accountId).eq('automation_key', 'publish').eq('source', 'automatic').eq('status', 'scheduled');
  let prepared = args.supabase.from('inr_agent_actions').update({ status: 'pending_validation', validation_required: true,
    execution_policy: 'manual_validation', validated_at: null, last_error: 'Cette publication attend désormais une validation manuelle.', updated_at: now })
    .eq('user_id', args.accountId).eq('automation_key', 'publish').eq('execution_policy', 'automatic_after_settings').in('status', ['prepared', 'scheduled']);
  if (args.optInId) {
    scheduled = scheduled.contains('payload', { adminAutomaticPublish: { optInId: args.optInId } });
    prepared = prepared.contains('metadata', { adminAutomaticPublish: { optInId: args.optInId } });
  }
  if (args.actionId) {
    scheduled = scheduled.contains('payload', { sourceActionId: args.actionId });
    prepared = prepared.eq('id', args.actionId);
  }
  const [scheduledResult, preparedResult] = await Promise.all([scheduled, prepared]);
  if (scheduledResult.error || preparedResult.error) throw new Error('La publication automatique ne peut pas être suspendue pour le moment.');
}

export async function isInrAgentAdminScheduledPublicationAuthorized(args: {
  supabase: any; row: any; actorAuthUserId?: string; isCron: boolean;
}) {
  const { row } = args;
  if (row.source !== 'automatic' || (row.automation_key !== 'publish' && row.target_tool !== 'booster' && row.action_type !== 'publication')) return true;
  const sourceActionId = row.payload?.sourceActionId;
  const marker = readInrAgentAdminAutomaticPublish(row.payload?.adminAutomaticPublish);
  if (!marker || typeof sourceActionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sourceActionId)) return false;
  return isInrAgentAdminAutomaticPublicationAuthorized({ supabase: args.supabase, accountId: row.user_id,
    actorAuthUserId: args.actorAuthUserId, isCron: args.isCron, marker, sourceActionId });
}
