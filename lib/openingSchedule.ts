import { isEncodedBusinessWeeklySchedule } from "./businessWeeklySchedule.ts";

export type OpeningHoursSpecification = {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string[];
  opens: string;
  closes: string;
};

const MAX_OPENING_SCHEDULE_LENGTH = 1_200;

const DAY_DEFINITIONS = [
  { fr: "lundi", aliases: ["lundi", "lun"], schema: "Monday" },
  { fr: "mardi", aliases: ["mardi", "mar"], schema: "Tuesday" },
  { fr: "mercredi", aliases: ["mercredi", "mer"], schema: "Wednesday" },
  { fr: "jeudi", aliases: ["jeudi", "jeu"], schema: "Thursday" },
  { fr: "vendredi", aliases: ["vendredi", "ven"], schema: "Friday" },
  { fr: "samedi", aliases: ["samedi", "sam"], schema: "Saturday" },
  { fr: "dimanche", aliases: ["dimanche", "dim"], schema: "Sunday" },
] as const;

const DAY_ALIAS_PATTERN = DAY_DEFINITIONS.flatMap((day) => day.aliases)
  .sort((a, b) => b.length - a.length)
  .join("|");

const DAY_REGEX = new RegExp(`\\b(${DAY_ALIAS_PATTERN})\\b`, "gi");
const TIME_RANGE_REGEX = /(\d{1,2})(?:\s*(?:h|:)\s*(\d{0,2}))?\s*(?:-|–|—|à|a)\s*(\d{1,2})(?:\s*(?:h|:)\s*(\d{0,2}))?/gi;

export function normalizeOpeningScheduleText(value: unknown) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_OPENING_SCHEDULE_LENGTH);
}

export function combineOpeningSchedule(openingDays: unknown, openingHours: unknown) {
  const days = isEncodedBusinessWeeklySchedule(openingDays)
    ? ""
    : normalizeOpeningScheduleText(openingDays);
  const hours = normalizeOpeningScheduleText(openingHours);

  if (!days) return hours;
  if (!hours) return days;

  const normalizedDays = days.toLocaleLowerCase("fr-FR");
  const normalizedHours = hours.toLocaleLowerCase("fr-FR");
  if (normalizedHours === normalizedDays || normalizedHours.startsWith(`${normalizedDays} :`)) {
    return hours;
  }

  return `${days} : ${hours}`.slice(0, MAX_OPENING_SCHEDULE_LENGTH);
}

export function getOpeningScheduleFromBusiness(source: unknown) {
  if (!source || typeof source !== "object") return "";
  const business = source as Record<string, unknown>;
  return combineOpeningSchedule(business.opening_days, business.opening_hours);
}

export function buildOpeningScheduleAiInstruction(source: unknown) {
  const schedule =
    source && typeof source === "object" && "business" in (source as Record<string, unknown>)
      ? combineOpeningSchedule(
          (source as { business?: { openingDays?: unknown; openingHours?: unknown } }).business?.openingDays,
          (source as { business?: { openingDays?: unknown; openingHours?: unknown } }).business?.openingHours,
        )
      : getOpeningScheduleFromBusiness(source);

  if (!schedule) {
    return "HORAIRES D’OUVERTURE : aucun horaire précis n’est fourni. Ne jamais inventer un jour d’ouverture, une heure, une disponibilité ou une fermeture ; ne mentionner les horaires que si la demande du pro les fournit explicitement.";
  }

  return [
    `HORAIRES D’OUVERTURE FOURNIS : ${schedule}`,
    "RÈGLE DE VÉRITÉ SUR LES HORAIRES : utiliser uniquement les jours et heures explicitement indiqués. Tout jour absent est considéré comme fermé. Ne jamais déduire, compléter ou inventer une ouverture, une fermeture, une plage horaire ou une disponibilité. En cas d’ambiguïté, ne pas affirmer d’horaire et inviter à vérifier auprès de l’entreprise.",
  ].join("\n");
}

function resolveDayIndex(alias: string) {
  const normalized = alias.toLocaleLowerCase("fr-FR");
  return DAY_DEFINITIONS.findIndex((day) =>
    (day.aliases as readonly string[]).includes(normalized),
  );
}

function extractSchemaDays(segment: string) {
  const matches = Array.from(segment.matchAll(new RegExp(DAY_REGEX.source, "gi")));
  const indexes = Array.from(
    new Set(
      matches
        .map((match) => resolveDayIndex(match[1] || ""))
        .filter((index) => index >= 0),
    ),
  );

  if (!indexes.length) return [];

  if (matches.length >= 2) {
    const first = matches[0];
    const second = matches[1];
    const between = segment.slice((first.index || 0) + first[0].length, second.index || 0);
    if (/(?:-|–|—|à|a|au|jusqu)/i.test(between)) {
      const start = indexes[0];
      const end = indexes[1];
      if (start <= end) {
        return DAY_DEFINITIONS.slice(start, end + 1).map(
          (day) => `https://schema.org/${day.schema}`,
        );
      }
    }
  }

  return indexes.map((index) => `https://schema.org/${DAY_DEFINITIONS[index].schema}`);
}

function formatTime(hourRaw: string, minuteRaw?: string) {
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw || "0");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "";
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function buildOpeningHoursSpecifications(scheduleValue: unknown) {
  const schedule = normalizeOpeningScheduleText(scheduleValue);
  if (!schedule) return undefined;

  const specifications: OpeningHoursSpecification[] = [];
  const segments = schedule
    .split(/\n|;/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    if (/\bferme(?:e|s)?\b/i.test(segment.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
      continue;
    }

    const days = extractSchemaDays(segment);
    if (!days.length) continue;

    for (const match of segment.matchAll(new RegExp(TIME_RANGE_REGEX.source, "gi"))) {
      const opens = formatTime(match[1], match[2]);
      const closes = formatTime(match[3], match[4]);
      if (!opens || !closes) continue;
      specifications.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: days,
        opens,
        closes,
      });
    }
  }

  return specifications.length ? specifications : undefined;
}
