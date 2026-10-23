import type { ReactNode } from "react";

export type ChannelMailboxSlot = {
  number: number;
  address?: string;
  provider: string;
  statusLabel?: string;
  needsUpdate?: boolean;
  disabled?: boolean;
  connectOptions: { label: string; onConnect: () => unknown | Promise<unknown> }[];
  onReconnect?: () => unknown | Promise<unknown>;
  onConfigure?: () => unknown | Promise<unknown>;
  onDisconnect?: () => unknown | Promise<unknown>;
};

export type ChannelBubbleConnection = {
  accountConnected?: boolean;
  accountLabel?: string;
  resourceLabel: string;
  resourceContent?: ReactNode;
  extraActions?: ReactNode;
  value?: string;
  options?: { value: string; label: string }[];
  onSelect?: (value: string) => unknown | Promise<unknown>;
  onLoad?: () => unknown | Promise<unknown>;
  onCreateResource?: (name: string) => boolean | Promise<boolean>;
  onConnect?: () => unknown | Promise<unknown>;
  connectOptions?: { label: string; onConnect: () => unknown | Promise<unknown> }[];
  onDisconnect?: () => unknown | Promise<unknown>;
  onDisconnectAccount?: () => unknown | Promise<unknown>;
  publicLinks?: ReactNode;
  mailboxes?: ChannelMailboxSlot[];
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  notice?: string | null;
  parameters?: ReactNode;
  parametersLabel?: string;
  parametersIcon?: "widget";
  parametersOwnHeading?: boolean;
  parametersFullScreen?: boolean;
  publicationTypes?: {
    value: { reelsEnabled: boolean; storiesEnabled: boolean; defaultMode?: "classic" | "reel" | "story" };
    loading?: boolean;
    saving?: boolean;
    error?: string | null;
    onLoad?: () => unknown | Promise<unknown>;
    onChange: (patch: { reelsEnabled?: boolean; storiesEnabled?: boolean; defaultMode?: "classic" | "reel" | "story" }) => unknown | Promise<unknown>;
  };
};

export type ChannelBubbleRenderer = (connection: ChannelBubbleConnection) => ReactNode;
