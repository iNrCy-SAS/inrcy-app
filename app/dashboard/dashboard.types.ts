export type ModuleStatus = "connected" | "available" | "reconnect" | "coming";
export type Accent = "cyan" | "purple" | "pink" | "orange";
export type Ownership = "none" | "rented" | "sold";

export type GoogleProduct = "ga4" | "gsc";
export type GoogleSource = "site_web";

export type ModuleAction = {
  key: string;
  label: string;
  variant: "view" | "connect" | "danger";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export type Module = {
  key: string;
  name: string;
  description: string;
  status: ModuleStatus;
  accent: Accent;
  actions: ModuleAction[];
};

export type NotificationItem = {
  id: string;
  category: "performance" | "action" | "information";
  categoryLabel: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_url: string | null;
  relativeDate: string;
  unread: boolean;
};

export type ActusLayout = "list" | "carousel" | "grid" | "compact";
export type ActusFont = "site" | "inter" | "poppins" | "montserrat" | "lora";
export type ActusDesign = "essential" | "classic" | "contemporary" | "futuristic" | "elegant";
export type ActusTheme = "white" | "dark" | "gray" | "nature" | "sand" | "blue" | "terracotta" | "anthracite" | "custom";

export const ACTUS_DESIGN_OPTIONS: Array<{ value: ActusDesign; label: string }> = [
  { value: "essential", label: "Essentiel \u2014 Arial, formes nettes" },
  { value: "classic", label: "Classique \u2014 Georgia, formes sobres" },
  { value: "contemporary", label: "Contemporain \u2014 police moderne, formes arrondies" },
  { value: "futuristic", label: "Futuriste \u2014 titres marqu\u00e9s, formes droites" },
  { value: "elegant", label: "\u00c9l\u00e9gant \u2014 Georgia, formes tr\u00e8s douces" },
];

export const ACTUS_THEME_OPTIONS: Array<{ value: ActusTheme; label: string }> = [
  { value: "white", label: "Blanc pur" },
  { value: "dark", label: "Noir profond" },
  { value: "gray", label: "Gris clair" },
  { value: "nature", label: "Vert clair naturel" },
  { value: "sand", label: "Beige chaud" },
  { value: "blue", label: "Bleu profond" },
  { value: "terracotta", label: "Marron orang\u00e9" },
  { value: "anthracite", label: "Gris anthracite" },
  { value: "custom", label: "Personnalis\u00e9e" },
];

export function normalizeActusLayout(value: unknown): ActusLayout {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "carousel" || raw === "grid" || raw === "compact" ? raw : "list";
}

export function normalizeActusDesign(value: unknown): ActusDesign {
  const raw = String(value || "").trim().toLowerCase();
  return ["essential", "classic", "contemporary", "futuristic", "elegant"].includes(raw)
    ? raw as ActusDesign
    : "contemporary";
}

export function normalizeActusTheme(value: unknown): ActusTheme {
  const raw = String(value || "").trim().toLowerCase();
  return ACTUS_THEME_OPTIONS.some((option) => option.value === raw)
    ? raw as ActusTheme
    : "nature";
}

export function normalizeActusAccent(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(raw) ? raw : "";
}
