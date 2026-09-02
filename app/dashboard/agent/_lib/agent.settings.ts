import {
  INR_AGENT_DEFAULT_SETTINGS,
  sanitizeInrAgentSettings,
  type InrAgentAutomationSettings,
  type InrAgentPreferredMediaSource,
  type InrAgentSettings,
  type InrAgentTheme,
} from "@/lib/inrAgentSettings";
import {
  inrAgentMonthlyDateCount,
  normalizeInrAgentMonthDays,
} from "@/lib/inrAgentMonthSchedule";
import type {
  ChannelKey as BoosterChannelKey,
  BoosterCtaMode,
  DisplayKey as BoosterDisplayKey,
  BoosterPreferredCta,
} from "../../booster/publier/publishModal.shared";
import {
  agentChannelToBoosterDisplay,
  apiChannelToUi,
  apiToChannel,
  apiToDay,
  apiToTheme,
  automations,
  channelOptions,
  channelOrder,
  channelOrderRank,
  channelPayloadKeys,
  channelToApi,
  dayToApi,
  defaultConfigs,
  hourOptions,
  settingsOptions,
  themeToApi,
  weekDays,
} from "./agent.config";
import type {
  AgentPreparedAction,
  AgentScheduledAction,
  Automation,
  AutomationConfig,
  AutomationKey,
  ChannelKey,
  ConnectedChannelMap,
  HeaderToolLink,
  SelectOption,
} from "./agent.types";
import { asRecord, toggleItem } from "./agent.utils";

export function orderChannels(
  channels: ChannelKey[],
  allowedChannels?: readonly ChannelKey[],
): ChannelKey[] {
  const allowed = allowedChannels ? new Set<ChannelKey>(allowedChannels) : null;
  return Array.from(
    new Set(channels.filter((channel) => !allowed || allowed.has(channel))),
  ).sort(
    (a, b) =>
      (channelOrderRank[a] ?? Number.MAX_SAFE_INTEGER) -
      (channelOrderRank[b] ?? Number.MAX_SAFE_INTEGER),
  );
}

export function toggleChannelItem(
  items: ChannelKey[],
  item: ChannelKey,
  allowedChannels: readonly ChannelKey[],
) {
  return orderChannels(toggleItem(items, item), allowedChannels);
}

export function boosterDisplayKeyFromAgentChannel(
  channel: ChannelKey | "" | null | undefined,
): BoosterDisplayKey {
  return agentChannelToBoosterDisplay[channel as ChannelKey] || "inrcy_site";
}

export function boosterChannelKeyFromAgentChannel(
  channel: ChannelKey | "" | null | undefined,
): BoosterChannelKey {
  return boosterDisplayKeyFromAgentChannel(channel) as BoosterChannelKey;
}

export function normalizeUiChannelKey(value: unknown): ChannelKey | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const mapped = apiChannelToUi[raw] || apiChannelToUi[raw.toLowerCase()];
  if (mapped) return mapped;
  return channelOptions[raw as ChannelKey] ? (raw as ChannelKey) : null;
}

export function normalizeUiChannels(...inputs: unknown[]): ChannelKey[] {
  const channels: ChannelKey[] = [];
  for (const input of inputs) {
    const values = Array.isArray(input) ? input : input ? [input] : [];
    for (const value of values) {
      const channel = normalizeUiChannelKey(value);
      if (channel && !channels.includes(channel)) channels.push(channel);
    }
  }
  return orderChannels(channels);
}

export function channelPayloadLookupKeys(channel: ChannelKey | null): string[] {
  if (!channel) return [];
  const displayKey = boosterDisplayKeyFromAgentChannel(channel);
  return Array.from(new Set([displayKey, channel, ...channelPayloadKeys[channel]]));
}

export function recordValueForUiChannel(
  record: Record<string, unknown>,
  channel: ChannelKey | null,
): unknown {
  for (const key of channelPayloadLookupKeys(channel)) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

export function firstRecordValueForUiChannels(
  record: Record<string, unknown>,
  channels: ChannelKey[],
): unknown {
  for (const channel of channels) {
    const value = recordValueForUiChannel(record, channel);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function canonicalizeRecordForBoosterChannels(
  input: unknown,
  channels: BoosterChannelKey[],
): Record<string, unknown> {
  const record = asRecord(input);
  if (!record) return {};
  const output: Record<string, unknown> = {};
  for (const channel of channels) {
    const uiChannel = normalizeUiChannelKey(channel);
    const value = recordValueForUiChannel(record, uiChannel);
    if (value !== undefined) output[channel] = value;
  }
  return output;
}

export function normalizeAgentCtaMode(value: unknown): BoosterCtaMode {
  const raw = String(value || "").trim();
  if (["none", "website", "call", "message", "custom"].includes(raw))
    return raw as BoosterCtaMode;
  return "none";
}

export function inferPreferredCtaChoiceFromLabel(
  label: string,
  fallback: BoosterPreferredCta = "devis",
): BoosterPreferredCta {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return "none";
  if (
    /(devis|quote|presupuesto|preventivo|offerte|angebot|orçamento)/i.test(
      normalized,
    )
  )
    return "devis";
  if (/(appeler|call|llamar|chiama|anrufen|bellen|ligar)/i.test(normalized))
    return "appeler";
  if (/(message|mensaje|messaggio|nachricht|bericht)/i.test(normalized))
    return "message";
  if (/(site|website|web|sitio)/i.test(normalized)) return "site";
  return fallback;
}

export function normalizeAgentExternalHref(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^(https?:)?\/\//i.test(raw))
    return raw.startsWith("//") ? `https:${raw}` : raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw))
    return `https://${raw}`;
  return raw;
}

export function sanitizeCachedConnectedChannels(
  value: unknown,
): ConnectedChannelMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const next: ConnectedChannelMap = {};

  for (const channel of channelOrder) {
    if (typeof source[channel] === "boolean") {
      next[channel] = source[channel] as boolean;
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}

export function isCachedPreparedAction(value: unknown): value is AgentPreparedAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0;
}

export function isCachedScheduledAction(value: unknown): value is AgentScheduledAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0;
}

export function connectedChannelsForAutomation(
  automation: Automation,
  connectedChannels: ConnectedChannelMap | null,
): ChannelKey[] {
  if (!connectedChannels) return automation.availableChannels;
  return orderChannels(
    automation.availableChannels.filter((channel) =>
      Boolean(connectedChannels[channel]),
    ),
    automation.availableChannels,
  );
}

export function connectedChannelMessage(automation: Automation | null) {
  if (!automation || automation.availableChannels.length === 0) return "";
  if (automation.key === "grow") {
    return "Aucune boîte mail connectée. Connecte une boîte dans iNr’Send avant de laisser iNr’Agent travailler dans Propulser.";
  }
  if (automation.key === "loyalty") {
    return "Aucune boîte mail connectée. Connecte une boîte dans iNr’Send avant de laisser iNr’Agent travailler dans Fidéliser.";
  }
  if (automation.key === "publish") {
    return "Aucun canal de publication connecté. Connecte au moins un canal dans l’application avant de laisser iNr’Agent publier.";
  }
  return "Aucun canal connecté pour cette automatisation.";
}

export function normalizeConfigsForConnectedChannels(
  current: Record<AutomationKey, AutomationConfig>,
  connectedChannels: ConnectedChannelMap,
): Record<AutomationKey, AutomationConfig> {
  let changed = false;
  const next = { ...current };

  for (const automation of automations) {
    if (
      automation.key === "stats" ||
      automation.availableChannels.length === 0
    ) {
      continue;
    }

    const currentConfig = current[automation.key];
    const availableChannels = connectedChannelsForAutomation(
      automation,
      connectedChannels,
    );
    const channels = orderChannels(currentConfig.channels, availableChannels);
    const enabled =
      availableChannels.length > 0 ? currentConfig.enabled : false;
    const configChanged =
      enabled !== currentConfig.enabled ||
      channels.join("|") !== currentConfig.channels.join("|");

    if (configChanged) {
      changed = true;
      next[automation.key] = {
        ...currentConfig,
        enabled,
        channels,
      };
    }
  }

  return changed ? next : current;
}

export function dayOffsetLabel(day: string, offset: number) {
  const current = dayToApi[day] ?? 1;
  return apiToDay[(current + offset) % 7] ?? "Lundi";
}

export function normalizeConfigScheduleSlots(
  config: Pick<AutomationConfig, "day" | "time"> &
    Partial<Pick<AutomationConfig, "frequency" | "scheduleSlots">>,
) {
  const slotCount =
    config.frequency === "3 fois par semaine" ||
    config.frequency === "three_times_weekly"
      ? 3
      : config.frequency === "2 fois par semaine" ||
          config.frequency === "twice_weekly"
        ? 2
        : 1;
  const offsets = slotCount === 3 ? [0, 2, 4] : slotCount === 2 ? [0, 3] : [0];
  const first = config.scheduleSlots?.[0] || {
    day: config.day,
    time: config.time,
  };
  return offsets.map((offset, index) => {
    const fallbackDay = index === 0
      ? config.day
      : dayOffsetLabel(first.day || config.day, offset);
    const slot = config.scheduleSlots?.[index] || {
      day: fallbackDay,
      time: first.time || config.time,
    };
    return {
      day: weekDays.includes(slot.day) ? slot.day : fallbackDay,
      time: hourOptions.includes(slot.time) ? slot.time : config.time,
    };
  });
}

export function scheduleSlotsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallbackDay: string,
  fallbackTime: string,
  frequency: string,
) {
  const rawSlots = Array.isArray(metadata?.scheduleSlots)
    ? metadata?.scheduleSlots
    : [];
  const slots = rawSlots
    .map((item) => {
      const source =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const day =
        typeof source.day === "string"
          ? source.day
          : apiToDay[Number(source.dayOfWeek)] || "";
      const time = typeof source.time === "string" ? source.time : "";
      return {
        day: weekDays.includes(day) ? day : "",
        time: hourOptions.includes(time) ? time : "",
      };
    })
    .filter((slot) => slot.day && slot.time);

  return normalizeConfigScheduleSlots({
    day: slots[0]?.day || fallbackDay,
    time: slots[0]?.time || fallbackTime,
    frequency,
    scheduleSlots:
      slots.length > 0
        ? slots
        : undefined,
  });
}

export function optionLabel<T extends string>(
  options: SelectOption<T>[],
  value: T,
  fallback: string,
) {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

export function optionValue<T extends string>(
  options: SelectOption<T>[],
  label: string,
  fallback: T,
) {
  return options.find((option) => option.label === label)?.value ?? fallback;
}

export function settingsToConfigs(
  settings: InrAgentSettings,
): Record<AutomationKey, AutomationConfig> {
  return Object.fromEntries(
    automations.map((automation) => {
      const defaults = defaultConfigs[automation.key];
      const source =
        settings.automations[automation.key] ??
        INR_AGENT_DEFAULT_SETTINGS.automations[automation.key];
      const frequency = optionLabel(
        settingsOptions[automation.key].frequency,
        source.frequency,
        defaults.frequency,
      );
      const config: AutomationConfig = {
        ...defaults,
        enabled: source.enabled,
        frequency,
        day: apiToDay[source.dayOfWeek] ?? defaults.day,
        time: source.time || defaults.time,
        scheduleSlots: scheduleSlotsFromMetadata(
          source.metadata,
          apiToDay[source.dayOfWeek] ?? defaults.day,
          source.time || defaults.time,
          frequency,
        ),
        monthDays: normalizeInrAgentMonthDays(
          source.metadata?.monthDays,
          frequency,
        ),
        channels: orderChannels(
          source.allowedChannels
            .map((channel) => apiToChannel[channel])
            .filter(
              (channel): channel is ChannelKey =>
                Boolean(channel) &&
                automation.availableChannels.includes(channel),
            ),
          automation.availableChannels,
        ),
        themes: source.allowedThemes
          .map((theme) => apiToTheme[theme])
          .filter(
            (theme): theme is string =>
              Boolean(theme) && automation.availableThemes.includes(theme),
          ),
        validation: optionLabel(
          settingsOptions[automation.key].validation,
          source.validationMode,
          defaults.validation,
        ),
        signatureAutomatic:
          typeof source.metadata?.signatureAutomatic === "boolean"
            ? source.metadata.signatureAutomatic
            : true,
        preferredMediaSource: source.preferredMediaSource,
      };

      return [automation.key, config];
    }),
  ) as Record<AutomationKey, AutomationConfig>;
}

export function configToAutomationSettings(
  key: AutomationKey,
  config: AutomationConfig,
  existing: InrAgentAutomationSettings,
): InrAgentAutomationSettings {
  const options = settingsOptions[key];
  const frequency = optionValue(
    options.frequency,
    config.frequency,
    existing.frequency,
  );
  const normalizedSlots = normalizeConfigScheduleSlots(config);
  const metadataWithoutScheduleSlots = { ...(existing.metadata || {}) };
  delete metadataWithoutScheduleSlots.scheduleSlots;
  delete metadataWithoutScheduleSlots.monthDays;
  const monthlyDateCount = inrAgentMonthlyDateCount(frequency);
  const nextMetadata = {
    ...metadataWithoutScheduleSlots,
    preferredMediaSource: config.preferredMediaSource,
    ...(key === "grow" || key === "loyalty"
      ? { signatureAutomatic: config.signatureAutomatic }
      : {}),
    ...(frequency === "twice_weekly" || frequency === "three_times_weekly"
      ? {
          scheduleSlots: normalizedSlots.slice(0, frequency === "three_times_weekly" ? 3 : 2).map((slot) => ({
            day: slot.day,
            dayOfWeek: dayToApi[slot.day] ?? existing.dayOfWeek,
            time: slot.time,
          })),
        }
      : {}),
    ...(monthlyDateCount
      ? {
          monthDays: normalizeInrAgentMonthDays(config.monthDays, frequency),
        }
      : {}),
  };

  return {
    ...existing,
    enabled: config.enabled,
    frequency,
    dayOfWeek:
      dayToApi[normalizedSlots[0]?.day || config.day] ?? existing.dayOfWeek,
    time: monthlyDateCount
      ? config.time
      : normalizedSlots[0]?.time || config.time,
    validationMode: optionValue(
      options.validation,
      config.validation,
      existing.validationMode,
    ),
    allowedChannels: orderChannels(
      config.channels,
      automations.find((automation) => automation.key === key)
        ?.availableChannels,
    ).map((channel) => channelToApi[channel]),
    allowedThemes: config.themes
      .map((theme) => themeToApi[theme])
      .filter((theme): theme is InrAgentTheme => Boolean(theme)),
    useImageBank: key !== "stats",
    imageRequired: key === "publish",
    preferredMediaSource:
      key === "publish"
        ? config.preferredMediaSource
        : (existing.preferredMediaSource as InrAgentPreferredMediaSource),
    recipientScope:
      key === "grow" ? "all_crm" : key === "loyalty" ? "clients" : "none",
    sourceStrategy:
      key === "publish"
        ? "published_history"
        : key === "stats"
          ? "stats_snapshot"
          : "templates",
    metadata: nextMetadata,
  };
}

export function configsToSettings(
  baseSettings: InrAgentSettings,
  configs: Record<AutomationKey, AutomationConfig>,
): InrAgentSettings {
  const automationsByKey = Object.fromEntries(
    automations.map((automation) => {
      const existing =
        baseSettings.automations[automation.key] ??
        INR_AGENT_DEFAULT_SETTINGS.automations[automation.key];
      return [
        automation.key,
        configToAutomationSettings(
          automation.key,
          configs[automation.key],
          existing,
        ),
      ];
    }),
  ) as InrAgentSettings["automations"];
  const automationValues = Object.values(
    automationsByKey,
  ) as InrAgentAutomationSettings[];
  const globalEnabled = automationValues.some(
    (automation) => automation.enabled,
  );

  return sanitizeInrAgentSettings({
    ...baseSettings,
    globalEnabled,
    enabled: globalEnabled,
    automations: automationsByKey,
    frequency: automationsByKey.publish.frequency,
    dayOfWeek: automationsByKey.publish.dayOfWeek,
    time: automationsByKey.publish.time,
    mode: automationsByKey.publish.validationMode,
    allowedChannels: automationsByKey.publish.allowedChannels,
    useMediaLibrary: automationsByKey.publish.useImageBank,
  });
}

export function inrSendFolderForAutomation(key: AutomationKey) {
  if (key === "grow") return "propulsions";
  if (key === "loyalty") return "fidelisations";
  if (key === "stats") return "stats";
  return "publications";
}

export function headerToolLinkForAutomation(key: AutomationKey): HeaderToolLink {
  if (key === "grow") {
    return {
      label: "Propulser",
      compactLabel: "P",
      href: "/dashboard/propulser",
    };
  }
  if (key === "loyalty") {
    return {
      label: "Fidéliser",
      compactLabel: "F",
      href: "/dashboard/fideliser",
    };
  }
  if (key === "stats") {
    return {
      label: "iNr’Stats",
      compactLabel: "S",
      href: "/dashboard/stats",
      logoSrc: "/inrstats-logo-seul.png",
    };
  }
  return {
    label: "Booster",
    compactLabel: "B",
    href: "/dashboard?action=publish",
  };
}
