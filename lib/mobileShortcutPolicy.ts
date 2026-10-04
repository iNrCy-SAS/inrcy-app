export type MobileShortcutId =
  | "agent"
  | "inrsend"
  | "crm"
  | "calendar"
  | "stats"
  | "cash"
  | "propulser"
  | "fideliser"
  | "reputation"
  | "channels"
  | "business_dna"
  | "ai_configuration"
  | "media_studio";

export type MobileShortcutOption = {
  id: MobileShortcutId;
  href: string;
  iconSrc?: string;
};

export const MOBILE_SHORTCUT_MAX = 6;
export const MOBILE_SHORTCUT_TOTAL_MAX = MOBILE_SHORTCUT_MAX + 4;
export const MOBILE_SHORTCUTS_EVENT = "inrcy:mobile-shortcuts-updated";

export const DEFAULT_MOBILE_SHORTCUTS: readonly MobileShortcutId[] = [
  "agent",
  "inrsend",
  "crm",
  "calendar",
  "stats",
  "reputation",
];

export const MOBILE_SHORTCUT_OPTIONS: readonly MobileShortcutOption[] = [
  { id: "agent", href: "/dashboard/agent", iconSrc: "/mobile-shortcuts/optimized/inragent-shortcut.png" },
  { id: "inrsend", href: "/dashboard/mails", iconSrc: "/mobile-shortcuts/optimized/inrsend-shortcut.png" },
  { id: "crm", href: "/dashboard/crm", iconSrc: "/mobile-shortcuts/optimized/inrcrm-shortcut.png" },
  { id: "calendar", href: "/dashboard/agenda", iconSrc: "/mobile-shortcuts/optimized/inrcalendar-shortcut.png" },
  { id: "stats", href: "/dashboard/stats", iconSrc: "/mobile-shortcuts/optimized/inrstats-shortcut.png" },
  { id: "cash", href: "/dashboard?action=cash", iconSrc: "/mobile-shortcuts/optimized/encaisser-shortcut.png" },
  { id: "propulser", href: "/dashboard/propulser", iconSrc: "/mobile-shortcuts/optimized/propulser-shortcut.png" },
  { id: "fideliser", href: "/dashboard/fideliser", iconSrc: "/mobile-shortcuts/optimized/fideliser-shortcut.png" },
  { id: "reputation", href: "/dashboard/e-reputation", iconSrc: "/mobile-shortcuts/optimized/reputation-shortcut.png" },
] as const;

// These destinations are always available, independently of saved personal shortcuts.
export const MOBILE_TOOL_SHORTCUT_OPTIONS: readonly MobileShortcutOption[] = [
  { id: "channels", href: "/dashboard?action=channels" },
  { id: "business_dna", href: "/dashboard/adn-entreprise", iconSrc: "/icons/business-dna.svg" },
  { id: "ai_configuration", href: "/dashboard/configuration-ia" },
  { id: "media_studio", href: "/dashboard/generer-media" },
];

const STANDARD_MOBILE_SHORTCUTS: readonly MobileShortcutId[] = ["agent", "inrsend", "stats", "reputation"];

const ALLOWED_IDS = new Set<MobileShortcutId>(
  MOBILE_SHORTCUT_OPTIONS.filter((option) => option.id !== "cash").map((option) => option.id),
);



export function normalizeMobileShortcuts(input: unknown): MobileShortcutId[] {
  if (!Array.isArray(input)) return [...DEFAULT_MOBILE_SHORTCUTS];
  const unique: MobileShortcutId[] = [];
  for (const value of input) {
    const id = String(value || "") as MobileShortcutId;
    if (!ALLOWED_IDS.has(id) || unique.includes(id)) continue;
    unique.push(id);
    if (unique.length >= MOBILE_SHORTCUT_MAX) break;
  }
  return unique.length > 0 ? unique : [...DEFAULT_MOBILE_SHORTCUTS];
}

export function getMobileShortcutOption(id: MobileShortcutId): MobileShortcutOption {
  return MOBILE_SHORTCUT_OPTIONS.find((option) => option.id === id)
    || MOBILE_TOOL_SHORTCUT_OPTIONS.find((option) => option.id === id)
    || MOBILE_SHORTCUT_OPTIONS[0];
}

export function getDisplayedMobileShortcuts(input: unknown, standardMode = false): MobileShortcutId[] {
  const personal = standardMode ? STANDARD_MOBILE_SHORTCUTS : normalizeMobileShortcuts(input);
  return [...personal, ...MOBILE_TOOL_SHORTCUT_OPTIONS.map((option) => option.id)];
}

export function getMobileShortcutLabel(id: MobileShortcutId, locale = "fr-FR"): string {
  const language = String(locale || "fr").slice(0, 2).toLowerCase();
  const labels: Record<string, Partial<Record<MobileShortcutId, string>>> = {
    fr: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Encaisser", propulser: "Propulser", fideliser: "Fidéliser", reputation: "E-réputation" },
    en: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Payments", propulser: "Grow", fideliser: "Loyalty", reputation: "E-reputation" },
    es: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Cobrar", propulser: "Impulsar", fideliser: "Fidelizar", reputation: "E-reputación" },
    it: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Incassare", propulser: "Crescita", fideliser: "Fidelizzare", reputation: "E-reputazione" },
    de: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Kassieren", propulser: "Wachstum", fideliser: "Bindung", reputation: "E-Reputation" },
    nl: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Betalingen", propulser: "Groeien", fideliser: "Klantenbinding", reputation: "E-reputatie" },
    pt: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "Receber", propulser: "Impulsionar", fideliser: "Fidelizar", reputation: "E-reputação" },
    th: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "รับชำระเงิน", propulser: "เติบโต", fideliser: "สร้างความภักดี", reputation: "ชื่อเสียงออนไลน์" },
    zh: { agent: "iNr’Agent", inrsend: "iNrSend", crm: "iNrCRM", calendar: "iNrCalendar", stats: "iNrStats", cash: "收款", propulser: "增长", fideliser: "客户忠诚", reputation: "在线口碑" },
  };
  const toolLabels: Record<string, Partial<Record<MobileShortcutId, string>>> = {
    fr: { channels: "Canaux", business_dna: "ADN de l’entreprise", ai_configuration: "Configuration IA", media_studio: "Studio Médias" },
    en: { channels: "Channels", business_dna: "Business DNA", ai_configuration: "AI settings", media_studio: "Media Studio" },
    es: { channels: "Canales", business_dna: "ADN de la empresa", ai_configuration: "Configuración IA", media_studio: "Estudio multimedia" },
    it: { channels: "Canali", business_dna: "DNA aziendale", ai_configuration: "Configurazione IA", media_studio: "Studio multimediale" },
    de: { channels: "Kanäle", business_dna: "Unternehmens-DNA", ai_configuration: "KI-Einstellungen", media_studio: "Medienstudio" },
    nl: { channels: "Kanalen", business_dna: "Bedrijfs-DNA", ai_configuration: "AI-instellingen", media_studio: "Mediastudio" },
    pt: { channels: "Canais", business_dna: "ADN da empresa", ai_configuration: "Configuração IA", media_studio: "Estúdio de mídia" },
    th: { channels: "ช่องทาง", business_dna: "ดีเอ็นเอธุรกิจ", ai_configuration: "การตั้งค่า AI", media_studio: "สตูดิโอสื่อ" },
    zh: { channels: "渠道", business_dna: "企业 DNA", ai_configuration: "AI 设置", media_studio: "媒体工作室" },
  };
  return toolLabels[language]?.[id] || labels[language]?.[id] || toolLabels.fr[id] || labels.fr[id] || id;
}

