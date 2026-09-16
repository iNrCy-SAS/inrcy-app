export type InrBadgePresetThemeId = "aurora" | "ocean" | "sunset" | "forest" | "graphite";
export type InrBadgeThemeId = InrBadgePresetThemeId | "identity";

export type InrBadgeThemeColors = {
  primary: string;
  secondary: string;
  accent: string;
};

export type InrBadgeThemePalette = InrBadgeThemeColors & {
  pageStart: string;
  pageEnd: string;
  surfaceStart: string;
  surfaceEnd: string;
};

export type InrBadgeThemeSettings = {
  id: InrBadgeThemeId;
  identityColors: InrBadgeThemeColors | null;
};

export type InrBadgeThemePreset = {
  id: InrBadgePresetThemeId;
  label: string;
  description: string;
  palette: InrBadgeThemePalette;
};

export const INRBADGE_THEME_PRESETS: readonly InrBadgeThemePreset[] = [
  {
    id: "aurora",
    label: "Aurore",
    description: "Bleu, violet et rose",
    palette: {
      primary: "#38BDF8",
      secondary: "#A855F7",
      accent: "#FB7185",
      pageStart: "#050A18",
      pageEnd: "#091223",
      surfaceStart: "#0A1836",
      surfaceEnd: "#081228",
    },
  },
  {
    id: "ocean",
    label: "Océan",
    description: "Cyan, bleu et turquoise",
    palette: {
      primary: "#22D3EE",
      secondary: "#2563EB",
      accent: "#14B8A6",
      pageStart: "#03131F",
      pageEnd: "#071A34",
      surfaceStart: "#082A3B",
      surfaceEnd: "#091C37",
    },
  },
  {
    id: "sunset",
    label: "Crépuscule",
    description: "Corail, orange et prune",
    palette: {
      primary: "#FB7185",
      secondary: "#F97316",
      accent: "#C084FC",
      pageStart: "#190A16",
      pageEnd: "#241021",
      surfaceStart: "#351528",
      surfaceEnd: "#25132B",
    },
  },
  {
    id: "forest",
    label: "Nature",
    description: "Émeraude, sapin et or",
    palette: {
      primary: "#34D399",
      secondary: "#0F766E",
      accent: "#FBBF24",
      pageStart: "#06140F",
      pageEnd: "#0A2018",
      surfaceStart: "#0D3024",
      surfaceEnd: "#0B211C",
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Ardoise, argent et cyan",
    palette: {
      primary: "#CBD5E1",
      secondary: "#64748B",
      accent: "#22D3EE",
      pageStart: "#06080D",
      pageEnd: "#111827",
      surfaceStart: "#1E293B",
      surfaceEnd: "#111827",
    },
  },
] as const;

export const DEFAULT_INRBADGE_THEME_SETTINGS: InrBadgeThemeSettings = {
  id: "aurora",
  identityColors: null,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const THEME_IDS = new Set<InrBadgeThemeId>([
  ...INRBADGE_THEME_PRESETS.map((theme) => theme.id),
  "identity",
]);

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeHex(value: unknown): string | null {
  const raw = String(value || "").trim();
  return HEX_COLOR.test(raw) ? raw.toUpperCase() : null;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex) || "#000000";
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}
function rgbToHex(r: number, g: number, b: number) {
  const channel = (value: number) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function mixHex(from: string, to: string, toRatio: number) {
  const first = hexToRgb(from);
  const second = hexToRgb(to);
  const ratio = Math.min(1, Math.max(0, toRatio));
  return rgbToHex(
    first.r + (second.r - first.r) * ratio,
    first.g + (second.g - first.g) * ratio,
    first.b + (second.b - first.b) * ratio,
  );
}

function rgbToHsl(hex: string) {
  const { r: rawR, g: rawG, b: rawB } = hexToRgb(hex);
  const r = rawR / 255;
  const g = rawG / 255;
  const b = rawB / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }

  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation, lightness };
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - chroma / 2;
  let rgb = [0, 0, 0];

  if (h < 60) rgb = [chroma, x, 0];
  else if (h < 120) rgb = [x, chroma, 0];
  else if (h < 180) rgb = [0, chroma, x];
  else if (h < 240) rgb = [0, x, chroma];
  else if (h < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

function createCompanionColor(source: string, hueShift: number) {
  const hsl = rgbToHsl(source);
  return hslToHex(
    hsl.hue + hueShift,
    Math.max(0.58, hsl.saturation),
    Math.min(0.68, Math.max(0.48, hsl.lightness)),
  );
}

function colorDistance(first: string, second: string) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function normalizeIdentityColors(value: unknown): InrBadgeThemeColors | null {
  const raw = asPlainObject(value);
  const primary = normalizeHex(raw.primary);
  if (!primary) return null;
  const secondary = normalizeHex(raw.secondary) || createCompanionColor(primary, 145);
  const accent = normalizeHex(raw.accent) || createCompanionColor(primary, -75);
  return { primary, secondary, accent };
}

export function createInrBadgeIdentityColors(candidates: readonly string[]): InrBadgeThemeColors {
  const colors = Array.from(new Set(candidates.map(normalizeHex).filter((color): color is string => Boolean(color))));
  const primary = colors[0] || "#38BDF8";
  const secondary = colors.find((color) => colorDistance(primary, color) >= 72)
    || createCompanionColor(primary, 145);
  const accent = colors.find((color) => color !== secondary && colorDistance(primary, color) >= 58 && colorDistance(secondary, color) >= 48)
    || createCompanionColor(primary, -75);
  return { primary, secondary, accent };
}

export function normalizeInrBadgeThemeSettings(value: unknown): InrBadgeThemeSettings {
  const raw = asPlainObject(value);
  const requestedId = String(raw.id || "").trim() as InrBadgeThemeId;
  return {
    id: THEME_IDS.has(requestedId) ? requestedId : DEFAULT_INRBADGE_THEME_SETTINGS.id,
    identityColors: normalizeIdentityColors(raw.identityColors),
  };
}

export function sanitizeInrBadgeThemeSettingsPayload(value: unknown): InrBadgeThemeSettings {
  return normalizeInrBadgeThemeSettings(value);
}

export function resolveInrBadgeThemePalette(value: unknown): InrBadgeThemePalette {
  const settings = normalizeInrBadgeThemeSettings(value);
  if (settings.id === "identity" && settings.identityColors) {
    const { primary, secondary, accent } = settings.identityColors;
    return {
      primary,
      secondary,
      accent,
      pageStart: mixHex(primary, "#020617", 0.84),
      pageEnd: mixHex(secondary, "#071020", 0.82),
      surfaceStart: mixHex(primary, "#0B1628", 0.72),
      surfaceEnd: mixHex(secondary, "#081225", 0.76),
    };
  }

  return INRBADGE_THEME_PRESETS.find((theme) => theme.id === settings.id)?.palette
    || INRBADGE_THEME_PRESETS[0].palette;
}

export function getInrBadgeThemeCssVariables(value: unknown): Record<string, string> {
  const palette = resolveInrBadgeThemePalette(value);
  const rgb = (hex: string) => {
    const color = hexToRgb(hex);
    return `${color.r} ${color.g} ${color.b}`;
  };

  return {
    "--badge-primary": palette.primary,
    "--badge-secondary": palette.secondary,
    "--badge-accent": palette.accent,
    "--badge-primary-rgb": rgb(palette.primary),
    "--badge-secondary-rgb": rgb(palette.secondary),
    "--badge-accent-rgb": rgb(palette.accent),
    "--badge-page-start": palette.pageStart,
    "--badge-page-end": palette.pageEnd,
    "--badge-surface-start": palette.surfaceStart,
    "--badge-surface-end": palette.surfaceEnd,
  };
}
