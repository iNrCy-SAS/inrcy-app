"use client";

import { useTranslations } from "next-intl";


import React from "react";
import {
  DEFAULT_INRBADGE_APPOINTMENT_SETTINGS,
  normalizeInrBadgeAppointmentSettings,
  type InrBadgeAppointmentDaySettings,
  type InrBadgeAppointmentSettings,
  type InrBadgeAppointmentSlot,
} from "@/lib/inrBadgeSettings";
import { getSimpleFrenchApiError, getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { providerLabel, type MailAccountOption } from "../../agenda/agenda.shared";

const INRCALENDAR_SETTINGS_UPDATED_EVENT = "inrcalendar:settings-updated";

const REMINDER_OPTIONS = [
  { value: "confirmation", labelKey: "a_l_enregistrement_b105b45c" },
  { value: 2880, labelKey: "48h_avant_c4b98142" },
  { value: 1440, labelKey: "24h_avant_03e04550" },
  { value: 120, labelKey: "2h_avant_d3957c8b" },
] as const;

const WEEKDAY_ITEMS = [
  { key: "1", labelKey: "lundi_d257826e" },
  { key: "2", labelKey: "mardi_1e9d6d0b" },
  { key: "3", labelKey: "mercredi_382dd2f4" },
  { key: "4", labelKey: "jeudi_e9ddb155" },
  { key: "5", labelKey: "vendredi_cb289d87" },
  { key: "6", labelKey: "samedi_a9b27832" },
  { key: "0", labelKey: "dimanche_50176327" },
] as const;

const TIME_OPTIONS = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
  "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00",
];
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
const DAYS_AHEAD_OPTIONS = [7, 14, 21, 30, 45, 60];
const MIN_NOTICE_OPTIONS = [0, 2, 4, 12, 24, 48, 72];

function dispatchCalendarSettingsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INRCALENDAR_SETTINGS_UPDATED_EVENT));
}

function GlassCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="agendaSettings_glassCard"
      style={{
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
        padding: 14,
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.2px", color: "rgba(255,255,255,0.92)" }}>
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.68)",
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              lineHeight: 1.45,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {children ? <div style={{ display: "grid", gap: 10, marginTop: 12, minWidth: 0 }}>{children}</div> : null}
    </div>
  );
}

function Notice({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" | "success" }) {
  const color = tone === "error" ? "#fca5a5" : tone === "success" ? "#86efac" : "rgba(255,255,255,0.66)";
  return <div style={{ fontSize: 12.5, lineHeight: 1.45, color }}>{children}</div>;
}

function normalizeOffsets(value: unknown) {
  const list = Array.isArray(value) ? value : [1440, 120];
  return Array.from(new Set(list.map(Number).filter((item) => [2880, 1440, 120].includes(item))));
}

function getDaySettings(settings: InrBadgeAppointmentSettings, key: string): InrBadgeAppointmentDaySettings {
  return settings.dailySlots[key] || DEFAULT_INRBADGE_APPOINTMENT_SETTINGS.dailySlots[key] || DEFAULT_INRBADGE_APPOINTMENT_SETTINGS.dailySlots["1"];
}

function getDaySlots(daySettings: InrBadgeAppointmentDaySettings): InrBadgeAppointmentSlot[] {
  return Array.isArray(daySettings.slots) && daySettings.slots.length
    ? daySettings.slots
    : [{ startTime: daySettings.startTime, endTime: daySettings.endTime, durationMinutes: daySettings.durationMinutes }];
}

function parseMinutes(value: string) {
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formatMinutes(value: number) {
  const safeValue = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(safeValue / 60)).padStart(2, "0")}:${String(safeValue % 60).padStart(2, "0")}`;
}

function ensureSlotEndAfterStart(slot: InrBadgeAppointmentSlot): InrBadgeAppointmentSlot {
  const startMinutes = parseMinutes(slot.startTime);
  const endMinutes = parseMinutes(slot.endTime);
  if (startMinutes === null || endMinutes === null || endMinutes > startMinutes) return slot;
  return { ...slot, endTime: formatMinutes(startMinutes + Math.max(60, slot.durationMinutes || 60)) };
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string | number;
  options: Array<{ value: string | number; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6, minWidth: 0, opacity: disabled ? 0.48 : 1 }}>
      <span style={fieldLabelStyle}>{label}</span>
      <select className="agendaSettings_select" style={fieldStyle} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.82)",
  fontSize: 12.5,
  fontWeight: 850,
};

const fieldStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.92)",
  padding: "11px 12px",
  outline: "none",
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const globalGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const dayCardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  padding: 12,
  display: "grid",
  gap: 8,
  minWidth: 0,
};

const compactSelectStyle: React.CSSProperties = {
  ...fieldStyle,
  padding: "9px 10px",
  borderRadius: 10,
  fontSize: 13,
};

const slotDayBlockStyle: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  padding: 10,
  display: "grid",
  gap: 10,
  minWidth: 0,
};

const slotDayHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  minWidth: 0,
};

const slotStackStyle: React.CSSProperties = {
  display: "grid",
  gap: 7,
  minWidth: 0,
};

const slotRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(54px, 0.7fr) minmax(86px, 1fr) minmax(86px, 1fr) minmax(118px, 1.1fr) minmax(34px, auto)",
  gap: 8,
  alignItems: "center",
  minWidth: 0,
};

const slotHeaderStyle: React.CSSProperties = {
  ...slotRowStyle,
  color: "rgba(255,255,255,0.54)",
  fontSize: 10.5,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "0 2px",
};

const slotIndexStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.66)",
  fontSize: 11.5,
  fontWeight: 900,
};

const addSlotButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(139,92,246,0.34)",
  background: "rgba(139,92,246,0.14)",
  color: "rgba(255,255,255,0.92)",
  borderRadius: 999,
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const removeSlotButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.72)",
  borderRadius: 10,
  width: 34,
  height: 34,
  cursor: "pointer",
};


const dayNameStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.94)",
  fontSize: 13.5,
  fontWeight: 900,
};

const dayMetaStackStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  minWidth: 0,
};

const dayToggleInlineStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  color: "rgba(255,255,255,0.72)",
  fontSize: 12,
  fontWeight: 800,
};

const remindersGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const reminderLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  padding: "11px 12px",
  cursor: "pointer",
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

export default function AgendaSettingsContent() {
  const i18nT = useTranslations("agenda");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [accounts, setAccounts] = React.useState<MailAccountOption[]>([]);
  const [selectedMailAccountId, setSelectedMailAccountId] = React.useState("");
  const [sendConfirmationOnSave, setSendConfirmationOnSave] = React.useState(false);
  const [reminderOffsetsMinutes, setReminderOffsetsMinutes] = React.useState<number[]>([1440, 120]);
  const [appointmentSettings, setAppointmentSettings] = React.useState<InrBadgeAppointmentSettings>(DEFAULT_INRBADGE_APPOINTMENT_SETTINGS);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const loadSettings = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/calendar/settings", { cache: "no-store" });
      if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible de charger les réglages Agenda."));
      const json = await response.json().catch(() => ({}));
      setAccounts(Array.isArray(json?.accounts) ? json.accounts : []);
      setSelectedMailAccountId(String(json?.selectedMailAccountId || ""));
      setSendConfirmationOnSave(Boolean(json?.sendConfirmationOnSave));
      setReminderOffsetsMinutes(normalizeOffsets(json?.reminderOffsetsMinutes));
      setAppointmentSettings(normalizeInrBadgeAppointmentSettings(json?.appointmentSettings));
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, "Impossible de charger les réglages Agenda."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveSettings(next: {
    selectedMailAccountId?: string;
    sendConfirmationOnSave?: boolean;
    reminderOffsetsMinutes?: number[];
    appointmentSettings?: InrBadgeAppointmentSettings;
  }) {
    const payload = {
      selectedMailAccountId,
      sendConfirmationOnSave,
      reminderOffsetsMinutes,
      appointmentSettings,
      ...next,
    };

    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      const response = await fetch("/api/calendar/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible d’enregistrer les réglages Agenda."));
      const json = await response.json().catch(() => ({}));
      setSelectedMailAccountId(String(json?.selectedMailAccountId || payload.selectedMailAccountId || ""));
      setSendConfirmationOnSave(Boolean(json?.sendConfirmationOnSave ?? payload.sendConfirmationOnSave));
      setReminderOffsetsMinutes(normalizeOffsets(json?.reminderOffsetsMinutes ?? payload.reminderOffsetsMinutes));
      setAppointmentSettings(normalizeInrBadgeAppointmentSettings(json?.appointmentSettings ?? payload.appointmentSettings));
      setNotice(i18nT("reglages_enregistres_1ea1f406"));
      dispatchCalendarSettingsUpdated();
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, "Impossible d’enregistrer les réglages Agenda."));
      void loadSettings();
    } finally {
      setSaving(false);
    }
  }

  function toggleOffset(offset: number, checked: boolean) {
    const nextOffsets = checked
      ? Array.from(new Set([...reminderOffsetsMinutes, offset]))
      : reminderOffsetsMinutes.filter((item) => item !== offset);
    setReminderOffsetsMinutes(nextOffsets);
    void saveSettings({ reminderOffsetsMinutes: nextOffsets });
  }

  function updateAppointmentSettings(patch: Partial<InrBadgeAppointmentSettings>) {
    const nextSettings = normalizeInrBadgeAppointmentSettings({ ...appointmentSettings, ...patch });
    setAppointmentSettings(nextSettings);
    void saveSettings({ appointmentSettings: nextSettings });
  }

  function saveDaySettings(dayKey: string, daySettings: InrBadgeAppointmentDaySettings) {
    const nextSettings = normalizeInrBadgeAppointmentSettings({
      ...appointmentSettings,
      dailySlots: {
        ...appointmentSettings.dailySlots,
        [dayKey]: daySettings,
      },
    });
    setAppointmentSettings(nextSettings);
    void saveSettings({ appointmentSettings: nextSettings });
  }

  function updateDaySettings(dayKey: string, patch: Partial<InrBadgeAppointmentDaySettings>) {
    const currentDaySettings = getDaySettings(appointmentSettings, dayKey);
    saveDaySettings(dayKey, {
      ...currentDaySettings,
      ...patch,
    });
  }

  function updateDaySlot(dayKey: string, slotIndex: number, patch: Partial<InrBadgeAppointmentSlot>) {
    const currentDaySettings = getDaySettings(appointmentSettings, dayKey);
    const slots = getDaySlots(currentDaySettings).map((slot, index) =>
      index === slotIndex ? ensureSlotEndAfterStart({ ...slot, ...patch }) : slot
    );
    saveDaySettings(dayKey, {
      ...currentDaySettings,
      ...slots[0],
      slots,
    });
  }

  function addDaySlot(dayKey: string) {
    const currentDaySettings = getDaySettings(appointmentSettings, dayKey);
    const slots = getDaySlots(currentDaySettings);
    if (slots.length >= 3) return;

    const lastSlot = slots[slots.length - 1] || { startTime: "09:00", endTime: "12:00", durationMinutes: 60 };
    const duration = lastSlot.durationMinutes || 60;
    const lastEndMinutes = parseMinutes(lastSlot.endTime) ?? 12 * 60;
    const startTime = formatMinutes(Math.min(lastEndMinutes + 60, 22 * 60));
    const endTime = formatMinutes(Math.min((parseMinutes(startTime) ?? lastEndMinutes) + Math.max(60, duration), 23 * 60));
    const nextSlot = ensureSlotEndAfterStart({ startTime, endTime, durationMinutes: duration });
    const nextSlots = [...slots, nextSlot].slice(0, 3);

    saveDaySettings(dayKey, {
      ...currentDaySettings,
      enabled: true,
      ...nextSlots[0],
      slots: nextSlots,
    });
  }

  function removeDaySlot(dayKey: string, slotIndex: number) {
    const currentDaySettings = getDaySettings(appointmentSettings, dayKey);
    const slots = getDaySlots(currentDaySettings);
    if (slotIndex <= 0 || slots.length <= 1) return;
    const nextSlots = slots.filter((_, index) => index !== slotIndex);
    saveDaySettings(dayKey, {
      ...currentDaySettings,
      ...nextSlots[0],
      slots: nextSlots,
    });
  }

  return (
    <div style={{ display: "grid", gap: 12, width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <style>{`
        .agendaSettings_select option {
          color: #111827;
        }
        @media (max-width: 720px) {
          .agendaSettings_responsiveTwo {
            grid-template-columns: 1fr !important;
          }

          .agendaSettings_daysCard {
            padding: 8px !important;
            gap: 6px !important;
            overflow: hidden !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
          }

          .agendaSettings_dayBlock {
            padding: 8px !important;
            gap: 8px !important;
          }

          .agendaSettings_slotHeader,
          .agendaSettings_slotRow {
            grid-template-columns: minmax(42px, 0.65fr) minmax(54px, 0.82fr) minmax(54px, 0.82fr) minmax(62px, 0.9fr) minmax(28px, auto) !important;
            gap: 5px !important;
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
          }

          .agendaSettings_slotHeader {
            font-size: 8.5px !important;
            letter-spacing: 0.02em !important;
          }

          .agendaSettings_daySelect {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            padding: 7px 4px !important;
            font-size: 10.5px !important;
            border-radius: 8px !important;
            box-sizing: border-box !important;
          }
        }

        @media (max-width: 380px) {
          .agendaSettings_slotHeader,
          .agendaSettings_slotRow {
            grid-template-columns: minmax(36px, 0.58fr) minmax(46px, 0.74fr) minmax(46px, 0.74fr) minmax(54px, 0.82fr) minmax(26px, auto) !important;
            gap: 4px !important;
          }

          .agendaSettings_dayBlock {
            padding: 6px !important;
          }

          .agendaSettings_daySelect {
            padding-left: 3px !important;
            padding-right: 3px !important;
            font-size: 10px !important;
          }
        }
      `}</style>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.14)",
          background:
            "linear-gradient(135deg, rgba(56,189,248,0.16), rgba(244,114,182,0.12), rgba(251,146,60,0.10))",
          padding: 14,
          boxSizing: "border-box",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 950, color: "rgba(255,255,255,0.94)" }}>
          {i18nT("reglages_inr_calendar_cdc58ac4")}{" "}</div>
        <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.70)", lineHeight: 1.45 }}>
          {i18nT("gerez_la_boite_d_envoi_les_741aea10")}{" "}</div>
      </div>

      {loading ? <Notice>{i18nT("chargement_des_reglages_d3437d0f")}</Notice> : null}
      {saving ? <Notice>{i18nT("enregistrement_e7d5f232")}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <GlassCard title={i18nT("boite_d_envoi_des_rappels_f512176e")} subtitle="Les mails de rappel partiront de cette boîte mail iNr’Send.">
        <select
          className="agendaSettings_select"
          style={fieldStyle}
          value={selectedMailAccountId}
          disabled={loading}
          onChange={(e) => {
            const nextId = e.target.value;
            setSelectedMailAccountId(nextId);
            void saveSettings({ selectedMailAccountId: nextId });
          }}
        >
          <option value="">{i18nT("envoi_client_depuis_inrcy_66ed9943")}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {providerLabel(account.provider)} — {account.display_name || account.email_address}
            </option>
          ))}
        </select>
        <Notice>
          {selectedMailAccountId
            ? i18nT("boite_selectionnee_pour_les_futurs_rendez_6ecf0f05")
            : i18nT("aucune_boite_selectionnee_les_rappels_restent_7cc91777")}
        </Notice>
      </GlassCard>

      <GlassCard title={i18nT("creneaux_des_rappels_3f5f05b7")}>
        <div className="agendaSettings_responsiveTwo" style={remindersGridStyle}>
          {REMINDER_OPTIONS.map((option) => {
            const isConfirmation = option.value === "confirmation";
            const offset = typeof option.value === "number" ? option.value : null;
            const checked = isConfirmation ? sendConfirmationOnSave : offset !== null && reminderOffsetsMinutes.includes(offset);
            return (
              <label key={String(option.value)} style={reminderLabelStyle}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={loading}
                  onChange={(e) => {
                    if (isConfirmation) {
                      const checkedValue = e.target.checked;
                      setSendConfirmationOnSave(checkedValue);
                      void saveSettings({ sendConfirmationOnSave: checkedValue });
                      return;
                    }
                    if (offset !== null) toggleOffset(offset, e.target.checked);
                  }}
                  style={{ width: 16, height: 16, accentColor: "#ec4899" }}
                />
                <strong style={{ color: "rgba(255,255,255,0.92)", fontSize: 13.5 }}>{i18nT(option.labelKey)}</strong>
              </label>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard
        title={i18nT("prise_de_rdv_d4e3d750")}
        subtitle="Ces réglages concernent les créneaux proposés aux clients depuis votre fiche publique. L’ajout manuel d’un RDV dans iNr’Calendar reste libre."
      >
        <div className="agendaSettings_responsiveTwo" style={globalGridStyle}>
          <SelectField
            label={i18nT("proposer_sur_fa5ff748")}
            value={appointmentSettings.daysAhead}
            options={DAYS_AHEAD_OPTIONS.map((value) => ({ value, label: `${value} jours` }))}
            disabled={loading}
            onChange={(value) => updateAppointmentSettings({ daysAhead: Number(value) })}
          />
          <SelectField
            label={i18nT("delai_minimum_66e05140")}
            value={appointmentSettings.minNoticeHours}
            options={MIN_NOTICE_OPTIONS.map((value) => ({ value, label: value === 0 ? "Immédiat" : `${value}h avant` }))}
            disabled={loading}
            onChange={(value) => updateAppointmentSettings({ minNoticeHours: Number(value) })}
          />
        </div>

        <div className="agendaSettings_daysCard" style={dayCardStyle}>
          {WEEKDAY_ITEMS.map((day) => {
            const daySettings = getDaySettings(appointmentSettings, day.key);
            const slots = getDaySlots(daySettings).slice(0, 3);
            const canAddSlot = daySettings.enabled && slots.length < 3 && !loading;

            return (
              <div key={day.key} className="agendaSettings_dayBlock" style={{ ...slotDayBlockStyle, opacity: daySettings.enabled ? 1 : 0.62 }}>
                <div style={slotDayHeaderStyle}>
                  <div style={dayMetaStackStyle}>
                    <span style={dayNameStyle}>{i18nT(day.labelKey)}</span>
                    <label style={dayToggleInlineStyle}>
                      <input
                        type="checkbox"
                        checked={daySettings.enabled}
                        disabled={loading}
                        onChange={(e) => updateDaySettings(day.key, { enabled: e.target.checked })}
                        style={{ width: 16, height: 16, accentColor: "#8b5cf6" }}
                      />
                      <span>{daySettings.enabled ? i18nT("ouvert_0201d810") : i18nT("ferme_79516c40")}</span>
                    </label>
                  </div>

                  <button
                    type="button"
                    style={{ ...addSlotButtonStyle, opacity: canAddSlot ? 1 : 0.5, cursor: canAddSlot ? "pointer" : "not-allowed" }}
                    disabled={!canAddSlot}
                    onClick={() => addDaySlot(day.key)}
                  >
                    {i18nT("ajouter_un_creneau_11c55695")}{" "}</button>
                </div>

                <div style={slotStackStyle}>
                  <div className="agendaSettings_slotHeader" style={slotHeaderStyle}>
                    <span>{i18nT("creneau_285e769f")}</span>
                    <span>{i18nT("debut_f0955314")}</span>
                    <span>{i18nT("fin_4251065f")}</span>
                    <span>{i18nT("duree_6feac25e")}</span>
                    <span />
                  </div>

                  {slots.map((slot, slotIndex) => (
                    <div key={`${day.key}-${slotIndex}`} className="agendaSettings_slotRow" style={slotRowStyle}>
                      <span style={slotIndexStyle}>#{slotIndex + 1}</span>

                      <select
                        className="agendaSettings_select agendaSettings_daySelect"
                        style={compactSelectStyle}
                        value={slot.startTime}
                        disabled={!daySettings.enabled || loading}
                        onChange={(e) => updateDaySlot(day.key, slotIndex, { startTime: e.target.value })}
                      >
                        {TIME_OPTIONS.map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>

                      <select
                        className="agendaSettings_select agendaSettings_daySelect"
                        style={compactSelectStyle}
                        value={slot.endTime}
                        disabled={!daySettings.enabled || loading}
                        onChange={(e) => updateDaySlot(day.key, slotIndex, { endTime: e.target.value })}
                      >
                        {TIME_OPTIONS.map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>

                      <select
                        className="agendaSettings_select agendaSettings_daySelect"
                        style={compactSelectStyle}
                        value={String(slot.durationMinutes)}
                        disabled={!daySettings.enabled || loading}
                        onChange={(e) => updateDaySlot(day.key, slotIndex, { durationMinutes: Number(e.target.value) })}
                      >
                        {DURATION_OPTIONS.map((value) => (
                          <option key={value} value={String(value)}>{value} min</option>
                        ))}
                      </select>

                      <button
                        type="button"
                        style={{ ...removeSlotButtonStyle, visibility: slotIndex > 0 ? "visible" : "hidden" }}
                        disabled={slotIndex === 0 || loading}
                        onClick={() => removeDaySlot(day.key, slotIndex)}
                        aria-label={i18nT("supprimer_le_creneau_8367b797")}
                        title={i18nT("supprimer_le_creneau_8367b797")}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
