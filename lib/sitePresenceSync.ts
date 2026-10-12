import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { asRecord, asString } from '@/lib/tsSafe';

type SitePresenceRow = {
  provider: string;
  source: 'site_web';
  product: 'site';
  status: 'connected' | 'disconnected';
  resource_id: string | null;
  resource_label: string | null;
  display_name: string | null;
  meta: Record<string, unknown>;
};

function hasTruthyString(v: unknown) {
  return !!(asString(v) || '').trim();
}

function hasGoogleSetting(settingsNode: unknown, product: 'ga4' | 'gsc') {
  const node = asRecord(settingsNode);
  if (product === 'ga4') return hasTruthyString(asRecord(node.ga4).property_id) || hasTruthyString(asRecord(node.ga4).measurement_id);
  return hasTruthyString(asRecord(node.gsc).property);
}

export async function computeSitePresenceRows(userId: string): Promise<SitePresenceRow[]> {
  const proCfgRes = await supabaseAdmin.from('pro_tools_configs').select('settings').eq('user_id', userId).maybeSingle();
  if (proCfgRes.error) throw proCfgRes.error;
  const proSettings = asRecord(asRecord(proCfgRes.data).settings);
  const siteWeb = asRecord(proSettings.site_web);

  const siteWebUrl = (asString(siteWeb.url) || '').trim();

  const siteWebScore = (siteWebUrl ? 1 : 0) + (hasGoogleSetting(siteWeb, 'ga4') ? 1 : 0) + (hasGoogleSetting(siteWeb, 'gsc') ? 1 : 0);

  return [
    {
      provider: 'system',
      source: 'site_web',
      product: 'site',
      status: siteWebScore > 0 ? 'connected' : 'disconnected',
      resource_id: siteWebUrl || null,
      resource_label: siteWebUrl || null,
      display_name: 'Site web',
      meta: { score: siteWebScore, has_url: Boolean(siteWebUrl), ga4: hasGoogleSetting(siteWeb, 'ga4'), gsc: hasGoogleSetting(siteWeb, 'gsc') },
    },
  ];
}

export async function syncSitePresenceIntegrations(userId: string) {
  const rows = await computeSitePresenceRows(userId);
  for (const row of rows) {
    const { error } = await supabaseAdmin.from('integrations').upsert({
      user_id: userId,
      provider: row.provider,
      source: row.source,
      product: row.product,
      status: row.status,
      resource_id: row.resource_id,
      resource_label: row.resource_label,
      display_name: row.display_name,
      meta: row.meta,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider,source,product' });
    if (error) throw error;
  }
  return rows;
}
