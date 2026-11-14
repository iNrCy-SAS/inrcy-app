import 'server-only';
import { isInrAgentAdminScheduledPublicationAuthorized, parkInrAgentAdminAutomaticPublications } from '@/lib/inrAgentAdminPublishServer';
import { isAsyncPublicationMarkedInrAgentAuthorizationRevoked, terminateAsyncPublicationForRevokedInrAgentAuthorization } from '@/lib/boosterAsyncPublication';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const forbidden = { allowed: false as const, status: 403, code: 'inr_agent_admin_authorization_revoked',
  error: 'Cette publication automatique n’est plus autorisée. Vérifiez les réglages iNrAgent.' };

/** Use the hydrated durable origin only as a lookup key; ownership, mode and role come from the DB. */
export async function guardInrAgentAdminBoosterPublication(args: {
  supabase: any; accountId: string; actorAuthUserId?: string; isCron: boolean;
  body: unknown; asyncPublicationId?: string;
}) {
  try {
    const body = record(args.body), origin = record(body.origin);
    if (origin.source !== 'inr_agent' && body.source !== 'inr_agent') return { allowed: true as const };
    const parent = args.isCron && args.asyncPublicationId ? { userId: args.accountId, publicationId: args.asyncPublicationId } : null;
    const scheduledId = origin.scheduledActionId;
    if (scheduledId == null || scheduledId === '') return { allowed: true as const }; // Human, unscheduled iNrAgent action.
    const stop = async () => { if (parent) await terminateAsyncPublicationForRevokedInrAgentAuthorization(parent); return forbidden; };
    if (typeof scheduledId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scheduledId)) return await stop();
    const scheduled = await args.supabase.from('inr_agent_scheduled_actions')
      .select('id,user_id,automation_key,action_type,target_tool,source,status,payload')
      .eq('id', scheduledId).eq('user_id', args.accountId).maybeSingle();
    if (scheduled.error) throw scheduled.error;
    const row = scheduled.data;
    if (!row || row.action_type !== 'publication' || row.target_tool !== 'booster') return await stop();
    if (row.source !== 'automatic') return { allowed: true as const };
    if (parent && await isAsyncPublicationMarkedInrAgentAuthorizationRevoked(parent)) return await stop();
    if (row.status !== 'cancelled' && await isInrAgentAdminScheduledPublicationAuthorized({ supabase: args.supabase, row,
      actorAuthUserId: args.actorAuthUserId, isCron: args.isCron })) return { allowed: true as const };
    // A collaborator's rejected API request cannot revoke the owner's valid job.
    const accountStillAuthorized = !args.isCron && row.status !== 'cancelled'
      && await isInrAgentAdminScheduledPublicationAuthorized({ supabase: args.supabase, row, isCron: true });
    if (!accountStillAuthorized) {
      await parkInrAgentAdminAutomaticPublications({ supabase: args.supabase, accountId: args.accountId,
        actionId: typeof row.payload?.sourceActionId === 'string' ? row.payload.sourceActionId : row.id });
      return await stop();
    }
    return forbidden;
  } catch {
    return { allowed: false as const, status: 503, code: 'inr_agent_admin_authorization_check_unavailable',
      error: 'La vérification de cette publication automatique est indisponible. Réessayez dans un instant.' };
  }
}
