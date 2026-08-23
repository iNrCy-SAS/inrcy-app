import { DASHBOARD_CHANNEL_KEYS, type DashboardChannelKey } from '@/lib/dashboardChannels';
import type { ChannelStates } from '@/lib/channelConnectionState';
import type { ConnectionDisplayStatus } from '@/lib/connectionVersions';
import type { CubeKey, Overview } from '@/lib/metrics/computeMetrics';

export type InrstatsOverviewMetaLike = {
  generatedAt?: string;
  snapshotDate?: string | null;
  live?: boolean;
  [key: string]: unknown;
};

export type InrstatsOverviewLike = {
  meta?: InrstatsOverviewMetaLike;
  sources?: Record<string, { metrics?: unknown | null }>;
  [key: string]: unknown;
} | null;

export type InrstatsChannelConnectionSummary = {
  connected: boolean;
  accountConnected: boolean;
  configured: boolean;
  statsConnected: boolean;
  expired: boolean;
  requiresUpdate: boolean;
  connectionStatus: ConnectionDisplayStatus;
  resourceId: string | null;
  resourceLabel: string | null;
  resourceUrl: string | null;
};

export type InrstatsCapturedLeads = {
  week: number;
  month: number;
};

export type InrstatsCapturedLeadsByCube = {
  week: Partial<Record<CubeKey, number>>;
  month: Partial<Record<CubeKey, number>>;
};

export type InrstatsChannelBlock = {
  channel: DashboardChannelKey;
  periodDays: number | null;
  connection: InrstatsChannelConnectionSummary;
  overview: InrstatsOverviewLike;
  opportunities: number;
  capturedLeads: InrstatsCapturedLeads;
  estimatedValue: number;
  syncAt: number | null;
  snapshotDate: string | null;
  live: boolean;
  error: string | null;
};

export type InrstatsChannelBlocksByChannel = Record<DashboardChannelKey, InrstatsChannelBlock>;

export function createEmptyChannelConnection(): InrstatsChannelConnectionSummary {
  return {
    connected: false,
    accountConnected: false,
    configured: false,
    statsConnected: false,
    expired: false,
    requiresUpdate: false,
    connectionStatus: 'disconnected',
    resourceId: null,
    resourceLabel: null,
    resourceUrl: null,
  };
}

export function createEmptyChannelBlock(channel: DashboardChannelKey): InrstatsChannelBlock {
  return {
    channel,
    periodDays: null,
    connection: createEmptyChannelConnection(),
    overview: null,
    opportunities: 0,
    capturedLeads: { week: 0, month: 0 },
    estimatedValue: 0,
    syncAt: null,
    snapshotDate: null,
    live: false,
    error: null,
  };
}

export function createEmptyChannelBlocks(): InrstatsChannelBlocksByChannel {
  return DASHBOARD_CHANNEL_KEYS.reduce((acc, channel) => {
    acc[channel] = createEmptyChannelBlock(channel);
    return acc;
  }, {} as InrstatsChannelBlocksByChannel);
}

function toSyncAt(overview: Overview | null | undefined): number | null {
  const iso = overview?.meta?.generatedAt;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function readMetricError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const maybeError = (value as { error?: unknown }).error;
  return typeof maybeError === 'string' && maybeError.trim() ? maybeError.trim() : null;
}

function getOverviewError(channel: DashboardChannelKey, overview: Overview | null | undefined): string | null {
  const sources = overview?.sources;
  if (!sources || typeof sources !== 'object') return null;

  const sourceKeysByChannel: Record<DashboardChannelKey, string[]> = {
    site_inrcy: ['site_inrcy_ga4', 'site_inrcy_gsc'],
    site_web: ['site_web_ga4', 'site_web_gsc'],
    gmb: ['gmb'],
    facebook: ['facebook'],
    instagram: ['instagram'],
    linkedin: ['linkedin'],
    tiktok: ['tiktok'],
    youtube_shorts: ['youtube_shorts'],
    pinterest: ['pinterest'],
  };

  for (const sourceKey of sourceKeysByChannel[channel]) {
    const sourceNode = sources[sourceKey];
    const error = readMetricError(sourceNode?.metrics);
    if (error) return error;
  }

  return null;
}

function mapChannelConnection(channel: DashboardChannelKey, states: ChannelStates): InrstatsChannelConnectionSummary {
  switch (channel) {
    case 'site_inrcy': {
      const state = states.site_inrcy;
      return {
        connected: state.statsConnected,
        accountConnected: state.connected,
        configured: state.connected,
        statsConnected: state.statsConnected,
        expired: false,
        requiresUpdate: false,
        connectionStatus: state.statsConnected ? 'connected' : 'disconnected',
        resourceId: state.url,
        resourceLabel: state.url,
        resourceUrl: state.url,
      };
    }
    case 'site_web': {
      const state = states.site_web;
      return {
        connected: state.statsConnected,
        accountConnected: state.connected,
        configured: state.connected,
        statsConnected: state.statsConnected,
        expired: false,
        requiresUpdate: false,
        connectionStatus: state.statsConnected ? 'connected' : 'disconnected',
        resourceId: state.url,
        resourceLabel: state.url,
        resourceUrl: state.url,
      };
    }
    case 'gmb': {
      const state = states.gmb;
      return {
        connected: state.connected,
        accountConnected: state.accountConnected,
        configured: state.configured,
        statsConnected: state.connected && !state.requiresUpdate,
        expired: state.expired,
        requiresUpdate: state.requiresUpdate,
        connectionStatus: state.connection_status,
        resourceId: state.resource_id,
        resourceLabel: state.resource_label,
        resourceUrl: null,
      };
    }
    case 'facebook': {
      const state = states.facebook;
      return {
        connected: state.connected,
        accountConnected: state.accountConnected,
        configured: state.pageConnected,
        statsConnected: state.connected && !state.requiresUpdate,
        expired: state.expired,
        requiresUpdate: state.requiresUpdate,
        connectionStatus: state.connection_status,
        resourceId: state.resource_id,
        resourceLabel: state.resource_label,
        resourceUrl: state.page_url,
      };
    }
    case 'instagram': {
      const state = states.instagram;
      return {
        connected: state.connected,
        accountConnected: state.accountConnected,
        configured: state.connected,
        statsConnected: state.connected && !state.requiresUpdate,
        expired: state.expired,
        requiresUpdate: state.requiresUpdate,
        connectionStatus: state.connection_status,
        resourceId: state.resource_id,
        resourceLabel: state.username,
        resourceUrl: state.profile_url,
      };
    }
    case 'linkedin': {
      const state = states.linkedin;
      return {
        connected: state.connected,
        accountConnected: state.accountConnected,
        configured: state.connected,
        statsConnected: state.connected && !state.requiresUpdate,
        expired: state.expired,
        requiresUpdate: state.requiresUpdate,
        connectionStatus: state.connection_status,
        resourceId: state.organization_id || state.resource_id,
        resourceLabel: state.organization_name || state.display_name,
        resourceUrl: state.organization_id ? state.organization_url : state.profile_url,
      };
    }
    case 'tiktok': {
      const state = states.tiktok;
      return {
        connected: state.connected,
        accountConnected: state.accountConnected,
        configured: state.connected,
        statsConnected: state.connected && !state.requiresUpdate,
        expired: state.expired,
        requiresUpdate: state.requiresUpdate,
        connectionStatus: state.connection_status,
        resourceId: state.resource_id,
        resourceLabel: state.username,
        resourceUrl: state.profile_url,
      };
    }
    case 'youtube_shorts': {
      const state = states.youtube_shorts;
      return {
        connected: state.connected,
        accountConnected: state.accountConnected,
        configured: state.connected,
        statsConnected: state.connected && !state.requiresUpdate,
        expired: state.expired,
        requiresUpdate: state.requiresUpdate,
        connectionStatus: state.connection_status,
        resourceId: state.resource_id,
        resourceLabel: state.channel_name || state.channel_url,
        resourceUrl: state.channel_url,
      };
    }
    case 'pinterest': {
      const state = states.pinterest;
      return {
        connected: state.connected,
        accountConnected: state.accountConnected,
        configured: Boolean(state.default_board_id || state.connected),
        statsConnected: state.connected && !state.requiresUpdate,
        expired: state.expired,
        requiresUpdate: state.requiresUpdate,
        connectionStatus: state.connection_status,
        resourceId: state.default_board_id || state.resource_id,
        resourceLabel: state.default_board_name || state.username,
        resourceUrl: state.profile_url,
      };
    }
  }
}

export function buildChannelBlocks(params: {
  periodDays: number;
  overviews: Partial<Record<CubeKey, Overview>>;
  opportunitiesByCube: Record<CubeKey, number>;
  capturedLeadsByCube?: InrstatsCapturedLeadsByCube;
  estimatedByCube: Record<CubeKey, number>;
  channelStates: ChannelStates;
  preservedChannels?: Partial<Record<DashboardChannelKey, boolean>>;
}): InrstatsChannelBlocksByChannel {
  const { periodDays, overviews, opportunitiesByCube, capturedLeadsByCube, estimatedByCube, channelStates, preservedChannels } = params;
  const blocks = createEmptyChannelBlocks();

  for (const channel of DASHBOARD_CHANNEL_KEYS) {
    const overview = overviews[channel] ?? null;
    const connection = mapChannelConnection(channel, channelStates);
    const statsActive = connection.statsConnected;
    const preserved = Boolean(preservedChannels?.[channel]);
    blocks[channel] = {
      channel,
      periodDays,
      connection,
      overview: statsActive ? overview : null,
      opportunities: statsActive ? Math.max(0, Math.round(opportunitiesByCube[channel] || 0)) : 0,
      capturedLeads: statsActive
        ? {
            week: Math.max(0, Math.round(Number(capturedLeadsByCube?.week?.[channel] ?? 0))),
            month: Math.max(0, Math.round(Number(capturedLeadsByCube?.month?.[channel] ?? 0))),
          }
        : { week: 0, month: 0 },
      estimatedValue: statsActive ? Math.max(0, Math.round(estimatedByCube[channel] || 0)) : 0,
      syncAt: statsActive ? toSyncAt(overview) : null,
      snapshotDate: statsActive ? overview?.meta?.snapshotDate ?? null : null,
      live: statsActive ? Boolean(overview?.meta?.live) : false,
      error: statsActive && !preserved ? getOverviewError(channel, overview) : null,
    };
  }

  return blocks;
}
