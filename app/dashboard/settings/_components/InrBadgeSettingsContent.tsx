"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createInrBadgeQrMatrix } from "@/lib/inrBadgeQr";
import { createInrBadgeQrTrackingUrl, type InrBadgeProfileSummary } from "@/lib/inrBadge";
import { effectiveInrBadgeShareSettings } from "@/lib/inrBadgeEditionPolicy";
import { useDashboardEdition } from "@/app/dashboard/_components/DashboardEditionProvider";
import {
  DEFAULT_INRBADGE_APPOINTMENT_SETTINGS,
  DEFAULT_INRBADGE_SHARE_SETTINGS,
  normalizeInrBadgeAppointmentSettings,
  normalizeInrBadgeShareSettings,
  type InrBadgeAppointmentSettings,
  type InrBadgeShareKey,
  type InrBadgeShareSettings,
} from "@/lib/inrBadgeSettings";

type InrBadgeChannelStatus = {
  connected: boolean;
  url?: string | null;
};

type InrBadgeSettingsChannels = {
  inrSearch: InrBadgeChannelStatus;
  siteInrcy: InrBadgeChannelStatus;
  siteWeb: InrBadgeChannelStatus;
  googleBusiness: InrBadgeChannelStatus;
  facebook: InrBadgeChannelStatus;
  instagram: InrBadgeChannelStatus;
  linkedin: InrBadgeChannelStatus;
  pinterest?: InrBadgeChannelStatus;
  mails: InrBadgeChannelStatus;
  tiktok: InrBadgeChannelStatus;
  youtubeShorts?: InrBadgeChannelStatus;
};

type MailAccountOption = {
  id: string;
  provider?: string | null;
  email_address?: string | null;
  display_name?: string | null;
  status?: string | null;
  connection_status?: string | null;
  requires_update?: boolean | null;
};

type Props = {
  profile: InrBadgeProfileSummary;
  publicUrl: string;
  profileReady: boolean;
  channels: InrBadgeSettingsChannels;
  onOpenProfile: () => void;
  onOpenCalendarSettings: () => void;
};

type ShareKey = InrBadgeShareKey;
type ShareSettings = InrBadgeShareSettings;
type AppointmentSettings = InrBadgeAppointmentSettings;

const INRBADGE_HEADER_LINE = "iNr'Badge : mon entreprise en QR Code";
const INRBADGE_ICON_SRC = "/icons/inrbadge-dashboard.png";

function trim(value: unknown) {
  return String(value || "").trim();
}

function canShareChannel(channel: InrBadgeChannelStatus) {
  return Boolean(channel.connected && trim(channel.url));
}

function providerLabel(provider: unknown) {
  const value = trim(provider).toLowerCase();
  if (value === "microsoft") return "Microsoft";
  if (value === "gmail" || value === "google") return "Gmail";
  if (value === "imap") return "IMAP";
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Mail";
}

function isUsableMailAccount(account: MailAccountOption): boolean {
  return Boolean(trim(account.id) && trim(account.email_address) && trim(account.status).toLowerCase() === "connected" && account.connection_status !== "needs_update" && !account.requires_update);
}

function getDisplayName(profile: InrBadgeProfileSummary) {
  return [profile.firstName, profile.lastName].map(trim).filter(Boolean).join(" ") || "Votre nom";
}

function getStorageKey(profile: InrBadgeProfileSummary, publicUrl: string) {
  const id = trim(profile.userId) || publicUrl || "anonymous";
  return `inrcy_inrbadge_share_settings_v1:${id}`;
}

function loadShareSettings(storageKey: string): ShareSettings {
  if (typeof window === "undefined") return DEFAULT_INRBADGE_SHARE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_INRBADGE_SHARE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Record<ShareKey, unknown>>;
    return normalizeInrBadgeShareSettings(parsed);
  } catch {
    return DEFAULT_INRBADGE_SHARE_SETTINGS;
  }
}

function loadAppointmentSettings(storageKey: string): AppointmentSettings {
  if (typeof window === "undefined") return DEFAULT_INRBADGE_APPOINTMENT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(`${storageKey}:rdv`);
    if (!raw) return DEFAULT_INRBADGE_APPOINTMENT_SETTINGS;
    return normalizeInrBadgeAppointmentSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_INRBADGE_APPOINTMENT_SETTINGS;
  }
}


function loadSelectedMailAccountId(storageKey: string) {
  if (typeof window === "undefined") return "";
  try {
    return trim(window.localStorage.getItem(`${storageKey}:mailAccountId`));
  } catch {
    return "";
  }
}

function saveBadgeSettings(storageKey: string, settings: ShareSettings, appointmentSettings: AppointmentSettings, selectedMailAccountId = "") {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
    window.localStorage.setItem(`${storageKey}:rdv`, JSON.stringify(appointmentSettings));
    window.localStorage.setItem(`${storageKey}:mailAccountId`, selectedMailAccountId);
  } catch {
    // stockage navigateur indisponible : on garde l'état en mémoire
  }
}

async function persistBadgeSettings(settings: ShareSettings, selectedMailAccountId?: string) {
  try {
    const body: { settings: ShareSettings; selectedMailAccountId?: string } = { settings, selectedMailAccountId };
    await fetch("/api/inrbadge/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Le localStorage garde une copie instantanée si le réseau est indisponible.
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 800);
}

function safeFilename(value: string) {
  return trim(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "inrbadge";
}

function drawQrOnCanvas(ctx: CanvasRenderingContext2D, matrix: boolean[][], x: number, y: number, size: number) {
  const moduleSize = size / matrix.length;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#111827";
  matrix.forEach((row, rowIndex) => {
    row.forEach((dark, colIndex) => {
      if (!dark) return;
      ctx.fillRect(x + colIndex * moduleSize, y + rowIndex * moduleSize, Math.ceil(moduleSize), Math.ceil(moduleSize));
    });
  });
}

async function downloadQrPng(publicUrl: string, profile: InrBadgeProfileSummary) {
  const matrix = createInrBadgeQrMatrix(publicUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1500;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#111827";
  ctx.font = "700 54px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(INRBADGE_HEADER_LINE, canvas.width / 2, 155);

  drawQrOnCanvas(ctx, matrix, 220, 300, 760);

  ctx.fillStyle = "#111827";
  ctx.font = "700 46px Arial, sans-serif";
  ctx.fillText(trim(profile.companyLegalName) || "Votre entreprise", canvas.width / 2, 1165);

  ctx.fillStyle = "#4b5563";
  ctx.font = "400 32px Arial, sans-serif";
  ctx.fillText(getDisplayName(profile), canvas.width / 2, 1220);

  ctx.font = "400 28px Arial, sans-serif";
  const urlText = publicUrl.length > 52 ? `${publicUrl.slice(0, 49)}...` : publicUrl;
  ctx.fillText(urlText, canvas.width / 2, 1295);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  downloadBlob(blob, `${safeFilename(trim(profile.companyLegalName) || getDisplayName(profile))}-inrbadge.png`);
}

function escapePdfText(value: string) {
  return trim(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createPdfBlob(publicUrl: string, profile: InrBadgeProfileSummary) {
  const matrix = createInrBadgeQrMatrix(publicUrl);
  const pageWidth = 595;
  const pageHeight = 842;
  const qrSize = 330;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = 245;
  const moduleSize = qrSize / matrix.length;
  const company = escapePdfText(trim(profile.companyLegalName) || "Votre entreprise");
  const name = escapePdfText(getDisplayName(profile));
  const url = escapePdfText(publicUrl);

  const rects = matrix.flatMap((row, rowIndex) => row.map((dark, colIndex) => {
    if (!dark) return "";
    const x = qrX + colIndex * moduleSize;
    const y = qrY + (matrix.length - rowIndex - 1) * moduleSize;
    return `${x.toFixed(2)} ${y.toFixed(2)} ${Math.ceil(moduleSize).toFixed(2)} ${Math.ceil(moduleSize).toFixed(2)} re f`;
  })).filter(Boolean).join("\n");

  const stream = [
    "1 1 1 rg 0 0 595 842 re f",
    "0.07 0.09 0.16 rg",
    "BT /F1 17 Tf 126 752 Td (iNr'Badge : mon entreprise en QR Code) Tj ET",
    "1 1 1 rg",
    `${(qrX - 18).toFixed(2)} ${(qrY - 18).toFixed(2)} ${(qrSize + 36).toFixed(2)} ${(qrSize + 36).toFixed(2)} re f`,
    "0.07 0.09 0.16 rg",
    rects,
    "0.07 0.09 0.16 rg",
    `BT /F1 20 Tf 70 190 Td (${company}) Tj ET`,
    "0.29 0.33 0.42 rg",
    `BT /F1 13 Tf 70 166 Td (${name}) Tj ET`,
    `BT /F1 10 Tf 70 140 Td (${url}) Tj ET`,
  ].join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(pdf.length);
    pdf += obj;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function FieldToggle({
  label,
  checked,
  disabled,
  helper,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  helper?: string;
  onChange: (checked: boolean) => void;
}) {
  const active = Boolean(checked) && !disabled;

  return (
    <button
      type="button"
      style={{ ...toggleRowStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!active);
      }}
    >
      <span style={{ minWidth: 0, textAlign: "left" }}>
        <strong style={toggleTitleStyle}>{label}</strong>
        {helper ? <small style={toggleHelperStyle}>{helper}</small> : null}
      </span>
      <span aria-hidden="true" style={active ? toggleCheckActiveStyle : toggleCheckStyle}>
        {active ? "✓" : ""}
      </span>
    </button>
  );
}

function FieldSelect({
  label,
  value,
  options,
  helper,
  disabled,
  onChange,
}: {
  label: string;
  value: string | number;
  options: Array<{ value: string | number; label: string }>;
  helper?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ ...selectRowStyle, opacity: disabled ? 0.55 : 1 }}>
      <span style={{ minWidth: 0 }}>
        <strong style={toggleTitleStyle}>{label}</strong>
        {helper ? <small style={toggleHelperStyle}>{helper}</small> : null}
      </span>
      <select value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export default function InrBadgeSettingsContent({
  profile,
  publicUrl,
  profileReady,
  channels,
  onOpenProfile,
  onOpenCalendarSettings,
}: Props) {
  const dashboardEdition = useDashboardEdition();
  const standardMode = dashboardEdition === "standard";
  const storageKey = useMemo(() => getStorageKey(profile, publicUrl), [profile, publicUrl]);
  const [settings, setSettings] = useState<ShareSettings>(() =>
    effectiveInrBadgeShareSettings(loadShareSettings(storageKey), dashboardEdition));
  const [appointmentSettings, setAppointmentSettings] = useState<AppointmentSettings>(() => loadAppointmentSettings(storageKey));
  const [selectedMailAccountId, setSelectedMailAccountId] = useState<string>(() => loadSelectedMailAccountId(storageKey));
  const [mailAccounts, setMailAccounts] = useState<MailAccountOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const localSettings = effectiveInrBadgeShareSettings(loadShareSettings(storageKey), dashboardEdition);
    const localAppointmentSettings = loadAppointmentSettings(storageKey);
    const localSelectedMailAccountId = loadSelectedMailAccountId(storageKey);
    setSettings(localSettings);
    setAppointmentSettings(localAppointmentSettings);
    setSelectedMailAccountId(localSelectedMailAccountId);

    const loadServerSettings = async () => {
      try {
        const [settingsRes, accountsRes] = await Promise.all([
          fetch("/api/inrbadge/settings", { cache: "no-store" }),
          standardMode ? Promise.resolve(null) : fetch("/api/integrations/status", { cache: "no-store" }),
        ]);
        const json = await settingsRes.json().catch(() => null) as { settings?: unknown; appointmentSettings?: unknown; selectedMailAccountId?: unknown } | null;
        const accountsJson = accountsRes
          ? await accountsRes.json().catch(() => null) as { mailAccounts?: unknown } | null
          : null;
        if (cancelled) return;

        if (accountsRes?.ok) {
          const nextAccounts = Array.isArray(accountsJson?.mailAccounts)
            ? accountsJson.mailAccounts.filter((account): account is MailAccountOption => !!account && typeof account === "object" && isUsableMailAccount(account as MailAccountOption))
            : [];
          setMailAccounts(nextAccounts);
        }

        if (!settingsRes.ok) return;
        const serverSettings = effectiveInrBadgeShareSettings(
          normalizeInrBadgeShareSettings(json?.settings),
          dashboardEdition,
        );
        const serverAppointmentSettings = normalizeInrBadgeAppointmentSettings(json?.appointmentSettings);
        const serverSelectedMailAccountId = trim(json?.selectedMailAccountId);
        setSettings(serverSettings);
        setAppointmentSettings(serverAppointmentSettings);
        setSelectedMailAccountId(serverSelectedMailAccountId);
        saveBadgeSettings(storageKey, serverSettings, serverAppointmentSettings, serverSelectedMailAccountId);
      } catch {
        // On garde les réglages locaux en secours.
      }
    };

    void loadServerSettings();
    return () => {
      cancelled = true;
    };
  }, [dashboardEdition, standardMode, storageKey]);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (downloadMenuRef.current && target && !downloadMenuRef.current.contains(target)) {
        setDownloadMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDownloadMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [downloadMenuOpen]);

  const updateSetting = (key: ShareKey, value: boolean) => {
    const next = normalizeInrBadgeShareSettings({ ...settings, [key]: value });
    setSettings(next);
    saveBadgeSettings(storageKey, next, appointmentSettings, selectedMailAccountId);
    void persistBadgeSettings(next, selectedMailAccountId);
    setNotice("Réglages iNr'Badge enregistrés.");
    window.setTimeout(() => setNotice(null), 1800);
  };

  const updateAppointmentSettings = (patch: Partial<AppointmentSettings>) => {
    const next = normalizeInrBadgeAppointmentSettings({ ...appointmentSettings, ...patch });
    setAppointmentSettings(next);
    saveBadgeSettings(storageKey, settings, next, selectedMailAccountId);
    void persistBadgeSettings(settings, selectedMailAccountId);
    setNotice("Réglages de prise de RDV enregistrés.");
    window.setTimeout(() => setNotice(null), 1800);
  };


  const toggleWeekday = (day: number) => {
    const exists = appointmentSettings.weekdays.includes(day);
    const nextWeekdays = exists
      ? appointmentSettings.weekdays.filter((item) => item !== day)
      : [...appointmentSettings.weekdays, day];
    updateAppointmentSettings({ weekdays: nextWeekdays });
  };

  const company = trim(profile.companyLegalName) || "Votre entreprise";
  const displayName = getDisplayName(profile);
  const phone = trim(profile.phone);
  const email = trim(profile.contactEmail);

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice("Lien copié.");
    } catch {
      setNotice("Impossible de copier automatiquement. Sélectionnez le lien manuellement.");
    }
    window.setTimeout(() => setNotice(null), 1800);
  };

  const openPreview = () => {
    if (!publicUrl) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  };

  const toggleDownloadMenu = () => {
    if (!publicUrl) return;
    setDownloadMenuOpen((current) => !current);
  };

  const downloadPdf = () => {
    if (!publicUrl) return;
    setDownloadMenuOpen(false);
    const blob = createPdfBlob(createInrBadgeQrTrackingUrl(publicUrl), profile);
    downloadBlob(blob, `${safeFilename(company)}-inrbadge.pdf`);
  };

  const downloadPng = () => {
    if (!publicUrl) return;
    setDownloadMenuOpen(false);
    void downloadQrPng(createInrBadgeQrTrackingUrl(publicUrl), profile);
  };

  const channelItems: Array<{ key: ShareKey; label: string; connected: boolean; helper: string }> = [
    { key: "inrSearch", label: "iNr'Search", connected: canShareChannel(channels.inrSearch), helper: "Disponible dès que votre page iNr'Search est publiée." },
    { key: "siteInrcy", label: "Site iNrCy", connected: canShareChannel(channels.siteInrcy), helper: "Disponible si le site iNrCy est actif avec un lien enregistré." },
    { key: "siteWeb", label: "Site web", connected: canShareChannel(channels.siteWeb), helper: "Disponible si le site web est renseigné." },
    { key: "googleBusiness", label: "Google Business", connected: canShareChannel(channels.googleBusiness), helper: "Disponible si Google Business est connecté avec un lien enregistré." },
    { key: "facebook", label: "Facebook", connected: canShareChannel(channels.facebook), helper: "Disponible si la page Facebook est connectée avec un lien enregistré." },
    { key: "instagram", label: "Instagram", connected: canShareChannel(channels.instagram), helper: "Disponible si Instagram est connecté avec un lien enregistré." },
    { key: "linkedin", label: "LinkedIn", connected: canShareChannel(channels.linkedin), helper: "Disponible si LinkedIn est connecté avec un lien enregistré." },
    { key: "pinterest", label: "Pinterest", connected: canShareChannel(channels.pinterest || { connected: false }), helper: "Disponible si Pinterest est connecté avec un lien enregistré." },
    { key: "tiktok", label: "TikTok", connected: canShareChannel(channels.tiktok), helper: "Disponible si TikTok est connecté avec un lien enregistré." },
    { key: "youtubeShorts", label: "YouTube", connected: canShareChannel(channels.youtubeShorts || { connected: false }), helper: "Disponible si YouTube est configuré avec un lien enregistré." },
  ];

  const mailSelectOptions = standardMode
    ? email ? [{ value: "", label: `Email de Mon profil — ${email}` }] : []
    : [
        ...(email ? [{ value: "", label: `Email du profil — ${email}` }] : []),
        ...mailAccounts.map((account) => ({
          value: account.id,
          label: `${providerLabel(account.provider)} — ${trim(account.display_name) || trim(account.email_address)}`,
        })),
      ];
  const selectedMailAccountExists = !standardMode && Boolean(
    selectedMailAccountId && mailAccounts.some((account) => account.id === selectedMailAccountId),
  );
  const fallbackMailAccountId = standardMode ? "" : trim(mailAccounts[0]?.id);
  const selectedMailValue = standardMode
    ? ""
    : selectedMailAccountExists
      ? selectedMailAccountId
      : email
        ? ""
        : fallbackMailAccountId;
  const canShowMailButton = standardMode ? Boolean(email) : Boolean(email || mailAccounts.length > 0);
  const mailHelper = standardMode
    ? email
      ? "Le bouton Mail utilise toujours l'adresse renseignée dans Mon profil."
      : "Ajoutez une adresse dans Mon profil pour afficher le bouton Mail."
    : !canShowMailButton
      ? "Ajoutez un email dans Mon profil ou connectez une boîte dans Mails."
      : selectedMailValue
        ? "Le bouton Mail utilisera cette boîte connectée."
        : "Le bouton Mail utilisera l'email du profil.";

  const updateSelectedMailAccount = (value: string) => {
    const nextId = trim(value);
    setSelectedMailAccountId(nextId);
    saveBadgeSettings(storageKey, settings, appointmentSettings, nextId);
    void persistBadgeSettings(settings, nextId);
  };

  useEffect(() => {
    if (standardMode) return;
    if (email || !fallbackMailAccountId || selectedMailAccountExists) return;
    setSelectedMailAccountId(fallbackMailAccountId);
    saveBadgeSettings(storageKey, settings, appointmentSettings, fallbackMailAccountId);
    void persistBadgeSettings(settings, fallbackMailAccountId);
  }, [appointmentSettings, email, fallbackMailAccountId, selectedMailAccountExists, settings, standardMode, storageKey]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={autoSaveBadgeStyle} aria-label="Sauvegarde automatique activée">
        <span aria-hidden="true" style={autoSaveDotStyle} />
        <span>Sauvegarde automatique</span>
      </div>

      <div style={heroCardStyle}>
        <div style={heroIconStyle}><img
          src={INRBADGE_ICON_SRC}
          alt=""
          width={128}
          height={128}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.04)", display: "block" }}
        /></div>
        <div style={{ minWidth: 0 }}>
          <h2 style={heroTitleStyle}>{INRBADGE_HEADER_LINE}</h2>
          <p style={heroSubTextStyle}>Le QR reste permanent. Les informations partagées peuvent évoluer sans réimprimer vos supports.</p>
        </div>
      </div>

      {!profileReady ? (
        <div style={warningCardStyle}>
          <strong>Profil incomplet</strong>
          <span>Complétez Mon profil pour activer votre iNr'Badge et générer le QR Code.</span>
          <button type="button" onClick={onOpenProfile} style={primarySmallButtonStyle}>compléter mon profil</button>
        </div>
      ) : null}

      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>QR Code</h3>
        <p style={mutedStyle}>{publicUrl || "Le lien sera généré dès que Mon profil sera complété."}</p>
        <div style={buttonGridStyle}>
          <button type="button" style={smallButtonStyle} onClick={openPreview} disabled={!publicUrl}>Aperçu fiche</button>
          <button type="button" style={smallButtonStyle} onClick={copyLink} disabled={!publicUrl}>copier le lien</button>
          <div style={downloadDropdownWrapStyle} ref={downloadMenuRef}>
            <button
              type="button"
              style={smallButtonStyle}
              onClick={toggleDownloadMenu}
              disabled={!publicUrl}
              aria-haspopup="menu"
              aria-expanded={downloadMenuOpen}
            >
              <span>Télécharger</span>
              <span aria-hidden="true" style={downloadChevronStyle}>▾</span>
            </button>
            {downloadMenuOpen ? (
              <div style={downloadDropdownMenuStyle} role="menu" aria-label="Choisir un format de téléchargement">
                <button type="button" style={downloadDropdownItemStyle} onClick={downloadPng} role="menuitem">PNG</button>
                <button type="button" style={downloadDropdownItemStyle} onClick={downloadPdf} role="menuitem">PDF</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>


      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>Informations partagées</h3>
        <div style={twoColumnsGridStyle}>
          <FieldToggle label="Logo" checked={Boolean(settings.logo)} helper={profile.logoUrl ? "Affiché en haut du badge." : "Logo iNr’Badge utilisé par défaut."} onChange={(value) => updateSetting("logo", value)} />
          <FieldToggle label="Nom du professionnel" checked={Boolean(settings.name)} onChange={(value) => updateSetting("name", value)} />
          <FieldToggle label="Entreprise" checked={Boolean(settings.company)} onChange={(value) => updateSetting("company", value)} />
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>Actions rapides</h3>
        <div style={twoColumnsGridStyle}>
          <FieldToggle label="Téléphone" checked={Boolean(settings.phone)} disabled={!phone} helper={!phone ? "À compléter dans Mon profil." : undefined} onChange={(value) => updateSetting("phone", value)} />
          <FieldToggle label="Enregistrer le contact" checked={Boolean(settings.saveContact)} helper="Prépare la fiche contact vCard pour l'étape publique." onChange={(value) => updateSetting("saveContact", value)} />

          <div style={fullWidthGridItemStyle}>
            <div style={{ ...mailActionCardStyle, opacity: canShowMailButton ? 1 : 0.55 }}>
              <label style={mailActionHeaderStyle}>
                <span style={mailActionHeaderTextStyle}>
                  <strong style={toggleTitleStyle}>Mail</strong>
                  <small style={toggleHelperStyle}>{mailHelper}</small>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(settings.email) && canShowMailButton}
                  disabled={!canShowMailButton}
                  onChange={(event) => updateSetting("email", event.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "#8b5cf6", flex: "0 0 auto" }}
                />
              </label>

              <select
                value={selectedMailValue}
                disabled={standardMode || !settings.email || !canShowMailButton || mailSelectOptions.length === 0}
                onChange={(event) => updateSelectedMailAccount(event.target.value)}
                style={selectStyle}
                aria-label="Adresse du bouton Mail"
              >
                {(mailSelectOptions.length ? mailSelectOptions : [{ value: "", label: "Aucune adresse disponible" }]).map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>Canaux disponibles au partage</h3>
        <div style={twoColumnsGridStyle}>
          {channelItems.map((item) => (
            <FieldToggle
              key={item.key}
              label={item.label}
              checked={Boolean(settings[item.key])}
              disabled={!item.connected}
              helper={item.connected ? "Activé sur votre badge si coché." : item.helper}
              onChange={(value) => updateSetting(item.key, value)}
            />
          ))}
        </div>
      </div>

      {!standardMode ? (
        <div style={cardStyle}>
          <h3 style={sectionTitleStyle}>Prise de RDV</h3>
          <div style={appointmentActionRowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FieldToggle label="Afficher Prendre RDV" checked={Boolean(settings.appointment)} helper="Ajoute le bouton sur la fiche publique." onChange={(value) => updateSetting("appointment", value)} />
            </div>
            <button
              type="button"
              style={settingsGearButtonStyle}
              onClick={onOpenCalendarSettings}
              aria-label="Ouvrir les réglages iNr’Calendar"
              title="Réglages iNr’Calendar"
            >
              <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>⚙</span>
            </button>
          </div>
          <p style={{ ...mutedStyle, marginTop: 12, marginBottom: 0 }}>iNr’Badge affiche le bouton. Les jours, horaires, durées de créneaux, délai minimum et rappels se règlent dans iNr’Calendar.</p>
        </div>
      ) : (
        <div style={lockedAppointmentCardStyle} aria-label="Prise de RDV réservée au forfait Premium">
          <div style={lockedAppointmentHeadingStyle}>
            <h3 style={{ ...sectionTitleStyle, margin: 0 }}>Prise de RDV</h3>
            <span style={premiumPillStyle}>Premium</span>
          </div>
          <div style={lockedAppointmentToggleStyle} aria-disabled="true">
            <span style={{ minWidth: 0, textAlign: "left" }}>
              <strong style={toggleTitleStyle}>Afficher Prendre RDV</strong>
              <small style={toggleHelperStyle}>Disponible avec iNr’Calendar dans le forfait Premium.</small>
            </span>
            <span aria-hidden="true" style={toggleCheckStyle} />
          </div>
        </div>
      )}


      {notice ? <div style={noticeStyle}>{notice}</div> : null}

   </div>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(15,23,42,0.72)",
  borderRadius: 18,
  padding: 14,
  boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
};

const autoSaveBadgeStyle: CSSProperties = {
  width: "fit-content",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  margin: "3px 0 0",
  padding: "7px 10px",
  lineHeight: 1.1,
  borderRadius: 999,
  border: "1px solid rgba(34,197,94,0.20)",
  background: "rgba(34,197,94,0.08)",
  color: "rgba(187,247,208,0.92)",
  fontSize: 12,
  fontWeight: 850,
};

const autoSaveDotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  background: "rgba(34,197,94,0.95)",
  boxShadow: "0 0 12px rgba(34,197,94,0.55)",
  flex: "0 0 auto",
};

const heroCardStyle: CSSProperties = {
  ...cardStyle,
  display: "flex",
  gap: 14,
  alignItems: "center",
  background: "linear-gradient(135deg, rgba(139,92,246,0.22), rgba(14,165,233,0.10)), rgba(15,23,42,0.76)",
};

const heroIconStyle: CSSProperties = {
  width: 58,
  height: 58,
  borderRadius: 999,
  overflow: "hidden",
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
  color: "#fff",
  fontWeight: 900,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.22)",
  boxShadow: "0 12px 28px rgba(0,0,0,0.24), 0 0 18px rgba(168,85,247,0.16)",
  padding: 0,
};

const heroTitleStyle: CSSProperties = { margin: 0, color: "#fff", fontSize: 18, lineHeight: 1.3 };
const heroSubTextStyle: CSSProperties = { margin: "6px 0 0", color: "rgba(226,232,240,0.72)", fontSize: 12, lineHeight: 1.45 };
const sectionTitleStyle: CSSProperties = { margin: "0 0 10px", color: "#fff", fontSize: 15 };
const mutedStyle: CSSProperties = { margin: "0 0 12px", color: "rgba(226,232,240,0.70)", fontSize: 12, overflowWrap: "anywhere" };
const twoColumnsGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
const fullWidthGridItemStyle: CSSProperties = { gridColumn: "1 / -1" };
const buttonGridStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const downloadDropdownWrapStyle: CSSProperties = { position: "relative", display: "inline-flex" };
const downloadChevronStyle: CSSProperties = { fontSize: 10, opacity: 0.8 };
const downloadDropdownMenuStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  minWidth: 150,
  display: "grid",
  gap: 6,
  padding: 8,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(15,23,42,0.96)",
  boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
  zIndex: 20,
};
const downloadDropdownItemStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.05)",
  color: "#fff",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "left",
  cursor: "pointer",
};

const smallButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.92)",
  borderRadius: 999,
  padding: "9px 12px",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const primarySmallButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  width: "fit-content",
  background: "linear-gradient(135deg, rgba(139,92,246,0.95), rgba(14,165,233,0.78))",
  border: "none",
};

const appointmentActionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const lockedAppointmentCardStyle: CSSProperties = {
  ...cardStyle,
  opacity: 0.72,
  background: "rgba(71,85,105,0.22)",
  border: "1px solid rgba(148,163,184,0.22)",
  filter: "grayscale(0.35)",
};

const lockedAppointmentHeadingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const premiumPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  padding: "3px 9px",
  borderRadius: 999,
  border: "1px solid rgba(196,181,253,0.38)",
  background: "rgba(139,92,246,0.18)",
  color: "#ddd6fe",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const settingsGearButtonStyle: CSSProperties = {
  width: 46,
  height: 46,
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "linear-gradient(135deg, rgba(139,92,246,0.92), rgba(14,165,233,0.82))",
  color: "#fff",
  cursor: "pointer",
  boxShadow: "0 12px 28px rgba(14,165,233,0.18), 0 10px 24px rgba(139,92,246,0.20)",
};

const warningCardStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: 8,
  color: "rgba(255,255,255,0.88)",
  background: "rgba(245,158,11,0.14)",
  border: "1px solid rgba(245,158,11,0.28)",
};

const toggleRowStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  border: "1px solid rgba(255,255,255,0.09)",
  background: "rgba(255,255,255,0.045)",
  borderRadius: 14,
  padding: "10px 12px",
  color: "#fff",
  font: "inherit",
};

const lockedAppointmentToggleStyle: CSSProperties = {
  ...toggleRowStyle,
  cursor: "not-allowed",
  opacity: 0.58,
};

const toggleCheckStyle: CSSProperties = {
  width: 18,
  height: 18,
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.30)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 950,
  lineHeight: 1,
};

const toggleCheckActiveStyle: CSSProperties = {
  ...toggleCheckStyle,
  border: "1px solid rgba(139,92,246,0.95)",
  background: "#8b5cf6",
};

const selectRowStyle: CSSProperties = {
  ...toggleRowStyle,
  alignItems: "stretch",
  flexDirection: "column",
  gap: 8,
};

const mailActionCardStyle: CSSProperties = {
  ...selectRowStyle,
  gap: 10,
  padding: "12px 12px",
  background: "linear-gradient(135deg, rgba(139,92,246,0.10), rgba(14,165,233,0.06)), rgba(255,255,255,0.045)",
};

const mailActionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const mailActionHeaderTextStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const selectStyle: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(2,6,23,0.45)",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 9px",
  fontSize: 12,
  fontWeight: 800,
};

const weekdayGridStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 };
const weekdayButtonStyle: CSSProperties = { ...smallButtonStyle, padding: "8px 10px", borderRadius: 12 };
const weekdayActiveStyle: CSSProperties = { ...weekdayButtonStyle, background: "linear-gradient(135deg, rgba(139,92,246,0.95), rgba(14,165,233,0.78))", border: "1px solid rgba(255,255,255,0.18)" };

const toggleTitleStyle: CSSProperties = { display: "block", fontSize: 13, color: "rgba(255,255,255,0.94)" };
const toggleHelperStyle: CSSProperties = { display: "block", marginTop: 3, fontSize: 11, color: "rgba(226,232,240,0.62)", lineHeight: 1.35 };

const previewOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 1200, display: "grid", placeItems: "center", padding: 16 };
const previewBackdropStyle: CSSProperties = { position: "absolute", inset: 0, border: "none", background: "rgba(2,6,23,0.72)", cursor: "pointer" };
const previewModalStyle: CSSProperties = { position: "relative", zIndex: 1, width: "min(100%, 560px)", maxHeight: "calc(100vh - 32px)", overflow: "auto", borderRadius: 24, padding: 14, border: "1px solid rgba(255,255,255,0.12)", background: "linear-gradient(180deg, rgba(9,16,32,0.96), rgba(15,23,42,0.98))", boxShadow: "0 30px 90px rgba(0,0,0,0.45)" };
const downloadModalStyle: CSSProperties = { ...previewModalStyle, width: "min(100%, 440px)" };
const previewModalHeaderStyle: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 };
const previewCloseButtonStyle: CSSProperties = { ...smallButtonStyle, whiteSpace: "nowrap" };
const previewPhoneShellStyle: CSSProperties = { width: "min(100%, 390px)", margin: "0 auto", padding: 10, borderRadius: 30, background: "linear-gradient(180deg, rgba(2,6,23,0.98), rgba(15,23,42,0.98))", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), 0 20px 60px rgba(0,0,0,0.35)" };
const downloadActionsStyle: CSSProperties = { display: "grid", gap: 10 };
const downloadActionButtonStyle: CSSProperties = { display: "grid", gap: 4, width: "100%", textAlign: "left", borderRadius: 18, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)", color: "#fff", padding: "14px 16px", cursor: "pointer" };
const previewIframeStyle: CSSProperties = { width: "100%", height: 760, border: "none", borderRadius: 22, background: "#08111f" };

const noticeStyle: CSSProperties = { position: "sticky", bottom: 10, justifySelf: "center", padding: "9px 12px", borderRadius: 999, background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.32)", color: "#d1fae5", fontSize: 12, fontWeight: 800 };
