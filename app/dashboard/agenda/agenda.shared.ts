export type ContactCategory = "particulier" | "professionnel" | "collectivite_publique";
export type ContactType = "prospect" | "client" | "fournisseur" | "partenaire" | "autre";
export type RdvMode = "create" | "edit" | "request";
export type RdvKind = "intervention" | "agenda";

export type CrmContact = {
  id: string;
  display_name?: string;
  last_name: string;
  first_name: string;
  company_name?: string;
  email: string;
  phone: string;
  address: string;
  city?: string;
  postal_code?: string;
  siren?: string;
  category?: string;
  contact_type?: string;
  notes?: string;
  important?: boolean;
};

export type EventItem = {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  htmlLink: string | null;
  description?: string | null;
  inrcy?: any | null;
};

export type DayEvent = EventItem & {
  allDay: boolean;
  startDate: Date | null;
  endDate: Date | null;
};

export type MailAccountOption = {
  id: string;
  provider: "gmail" | "microsoft" | "imap" | string;
  email_address: string;
  display_name: string | null;
};

export type GuestContactForm = {
  id: string;
  contactId: string;
  name: string;
  email: string;
};

export type ContactPayload = {
  display_name: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  email: string;
  phone: string;
  address: string;
  city?: string;
  postal_code?: string;
  siren?: string;
  category?: ContactCategory | string;
  contact_type?: ContactType | string;
  notes?: string;
  important?: boolean;
};

export const CATEGORY_LABEL: Record<ContactCategory, string> = {
  particulier: "Particulier",
  professionnel: "Professionnel",
  collectivite_publique: "Institution",
};

export const TYPE_LABEL: Record<ContactType, string> = {
  prospect: "Prospect",
  client: "Client",
  fournisseur: "Fournisseur",
  partenaire: "Partenaire",
  autre: "Autre",
};

export function providerLabel(provider: string) {
  return provider === "gmail" ? "Gmail" : provider === "microsoft" ? "Microsoft" : provider === "imap" ? "IMAP" : provider;
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function keyOf(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toDateOnly(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDateOnly(s: string) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const da = Number(m[3]);
  return new Date(y, mo, da, 0, 0, 0, 0);
}

export function isDateOnly(s: string | null) {
  return Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfWeekMonday(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const jsDay = x.getDay();
  const diff = jsDay === 0 ? -6 : 1 - jsDay;
  x.setDate(x.getDate() + diff);
  return x;
}

export function endOfWeekSunday(d: Date) {
  const s = startOfWeekMonday(d);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6, 23, 59, 59, 999);
}

export function formatMonthLabel(d: Date, locale = "fr-FR") {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
}

export function formatDayLabel(d: Date, locale = "fr-FR") {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function formatTime(d: Date, locale = "fr-FR") {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function buildQuarterHourOptions() {
  const out: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      out.push(`${pad2(hour)}:${pad2(minute)}`);
    }
  }
  return out;
}

export function accentFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const pick = h % 4;
  return pick === 0 ? "cyan" : pick === 1 ? "purple" : pick === 2 ? "pink" : "orange";
}

export function buildCrmDisplayName(firstName: string, lastName: string, companyName?: string) {
  const left = [firstName ?? "", lastName ?? ""].join(" ").replace(/\s+/g, " ").trim();
  const right = (companyName ?? "").trim();
  if (left && right) return `${left} / ${right}`;
  return left || right;
}

export function parseCrmDisplayName(v: string) {
  const raw = (v || "").trim();
  if (!raw) return { last_name: "", first_name: "", company_name: "" };
  const parts = raw.split("/");
  const left = (parts[0] || "").trim();
  const right = (parts.slice(1).join("/") || "").trim();
  return { last_name: left, first_name: "", company_name: right };
}

export function composeAddressLine(street: string, postal: string, city: string) {
  const s = (street ?? "").trim();
  const p = (postal ?? "").trim();
  const c = (city ?? "").trim();
  const tail = [p, c].filter(Boolean).join(" ").trim();
  return [s, tail].filter(Boolean).join(", ").trim();
}

export function buildIso(dateOnly: string, hhmm: string) {
  const [y, m, d] = dateOnly.split("-").map((x) => Number(x));
  const [hh, mm] = hhmm.split(":").map((x) => Number(x));
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
  return dt.toISOString();
}

export function getContactOptionLabel(contact: CrmContact, fallback: string) {
  return (
    (contact.company_name && contact.company_name.trim()) ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() ||
    contact.email ||
    fallback
  );
}

export function getEventWhenLabel(event: DayEvent, locale = "fr-FR", allDayLabel: string) {
  if (event.allDay) return allDayLabel;
  if (!event.startDate) return "";
  return `${formatTime(event.startDate, locale)}${event.endDate ? ` → ${formatTime(event.endDate, locale)}` : ""}`;
}

export function getInrcyStatus(event: EventItem | DayEvent | null | undefined) {
  const meta = event?.inrcy && typeof event.inrcy === "object" ? event.inrcy : {};
  return String((meta as any)?.status ?? "").trim().toLowerCase();
}

export function isDraftEvent(event: EventItem | DayEvent | null | undefined) {
  return getInrcyStatus(event) === "draft";
}

export function getEventAccentClass(accent: ReturnType<typeof accentFor>, styles: Record<string, string>) {
  return accent === "cyan"
    ? styles.accentCyan
    : accent === "purple"
      ? styles.accentPurple
      : accent === "pink"
        ? styles.accentPink
        : styles.accentOrange;
}
