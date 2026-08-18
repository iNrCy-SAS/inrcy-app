import type dashboardMessages from "@/messages/fr-FR/dashboard.json";

import type { ModuleStatus } from "@/app/dashboard/dashboard.types";

type WidenStrings<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? WidenStrings<U>[]
    : T extends object
      ? { [K in keyof T]: WidenStrings<T[K]> }
      : T;

export type DashboardCopy = WidenStrings<typeof dashboardMessages> & {
  locale: string;
};

type DashboardModuleCopy = {
  name: string;
  description: string;
  view?: string;
  connect?: string;
  disabledTitle?: string;
  siteOnlyTitle?: string;
};

export function getDashboardStatusLabel(status: ModuleStatus, copy: DashboardCopy) {
  if (status === "connected") return copy.status.connected;
  if (status === "available") return copy.status.toConnect;
  if (status === "reconnect") return copy.status.reconnect;
  return copy.status.soon;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function translateDashboardStatusText(value: string, copy: DashboardCopy) {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const normalized = normalizeText(raw);
  const progress = raw.match(/\d\s*\/\s*\d/)?.[0]?.replace(/\s+/g, "");
  const suffix = progress ? ` ${progress}` : "";

  if (normalized.includes("aucun site") || normalized.includes("no site")) return `${copy.status.noSite}${suffix}`;
  if (normalized.includes("desactive") || normalized.includes("disabled")) return `${copy.status.disabled}${suffix}`;
  if (normalized.includes("actualiser") || normalized.includes("update")) return `${copy.status.toUpdate}${suffix}`;
  if (normalized.includes("reconnexion") || normalized.includes("reconnect")) return `${copy.status.reconnect}${suffix}`;
  if (normalized.includes("deconnect") || normalized.includes("disconnected")) return `${copy.status.disconnected}${suffix}`;
  if (normalized.includes("configurer") || normalized.includes("set up")) return `${copy.status.toConfigure}${suffix}`;
  if (normalized.includes("connecter") || normalized.includes("to connect")) return `${copy.status.toConnect}${suffix}`;
  if (normalized.includes("connecte") || normalized.includes("connected")) return `${copy.status.connected}${suffix}`;
  if (normalized.includes("bientot") || normalized.includes("soon")) return `${copy.status.soon}${suffix}`;

  return raw;
}

export function getDashboardModuleCopy(copy: DashboardCopy, key: string): DashboardModuleCopy | undefined {
  return (copy.moduleCards as Record<string, DashboardModuleCopy>)[key];
}
