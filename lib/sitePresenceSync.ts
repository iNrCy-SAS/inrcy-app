import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { hasActiveInrcySite } from '@/lib/inrcySite';
import { asRecord, asString } from '@/lib/tsSafe';

type SitePresenceRow = {
  provider: string;
  source: 'site_inrcy' | 'site_web';
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
  const [profileRes, inrcyCfgRes, proCfgRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('inrcy_site_ownership').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('inrcy_site_configs').select('site_url,settings').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('pro_tools_configs').select('settings').eq('user_id', userId).maybeSingle(),
  ]);

  const readError = profileRes.error || inrcyCfgRes.error || proCfgRes.error;
  if (readError) throw readError;

  const profile = asRecord(profileRes.data);
  const inrcyCfg = asRecord(inrcyCfgRes.data);
  const inrcySettings = asRecord(inrcyCfg.settings);
  const proSettings = asRecord(asRecord(proCfgRes.data).settings);
  const siteWeb = asRecord(proSettings.site_web);

  const inrcyHasSite = hasActiveInrcySite(asString(profile.inrcy_site_ownership) || 'none');
  const inrcyUrl = (asString(inrcyCfg.site_url) || '').trim();
  const siteWebUrl = (asString(siteWeb.url) || '').trim();

  const inrcyScore = (inrcyHasSite && inrcyUrl ? 1 : 0) + (hasGoogleSetting(inrcySettings, 'ga4') ? 1 : 0) + (hasGoogleSetting(inrcySettings, 'gsc') ? 1 : 0);
  const siteWebScore = (siteWebUrl ? 1 : 0) + (hasGoogleSetting(siteWeb, 'ga4') ? 1 : 0) + (hasGoogleSetting(siteWeb, 'gsc') ? 1 : 0);

  return [
    {
      provider: 'system',
      source: 'site_inrcy',
      product: 'site',
      status: inrcyScore > 0 ? 'connected' : 'disconnected',
      resource_id: inrcyUrl || null,
      resource_label: inrcyUrl || null,
      display_name: 'Site iNrCy',
      meta: { score: inrcyScore, has_url: Boolean(inrcyHasSite && inrcyUrl), ga4: hasGoogleSetting(inrcySettings, 'ga4'), gsc: hasGoogleSetting(inrcySettings, 'gsc') },
    },
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
