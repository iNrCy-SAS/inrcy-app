"use client";

import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";

import {
  BUSINESS_WEEK_DAY_KEYS,
  normalizeBusinessWeeklySchedule,
  type BusinessScheduleDay,
  type BusinessScheduleSlot,
  type BusinessWeekDayKey,
  type BusinessWeeklySchedule,
} from "@/lib/businessWeeklySchedule";

type Props = {
  value: BusinessWeeklySchedule;
  onChange: (value: BusinessWeeklySchedule) => void;
};

const DEFAULT_SLOTS: BusinessScheduleSlot[] = [
  { start: "09:00", end: "12:00" },
  { start: "14:00", end: "18:00" },
];

function cloneSchedule(value: BusinessWeeklySchedule) {
  return normalizeBusinessWeeklySchedule(JSON.parse(JSON.stringify(value)));
}

function capitalize(value: string) {
  return value ? `${value[0].toLocaleUpperCase()}${value.slice(1)}` : value;
}

export default function BusinessScheduleEditor({ value, onChange }: Props) {
  const locale = useLocale();
  const t = useTranslations("dashboard.aiMemory");
  const schedule = normalizeBusinessWeeklySchedule(value);
  const days = BUSINESS_WEEK_DAY_KEYS.map((key, index) => ({
    key,
    label: capitalize(new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + index)))),
  }));
  const everyDay = BUSINESS_WEEK_DAY_KEYS.every((key) => schedule.days[key].open);
  const aroundTheClock = everyDay && BUSINESS_WEEK_DAY_KEYS.every((key) => schedule.days[key].allDay);

  const emit = (next: BusinessWeeklySchedule) => onChange(normalizeBusinessWeeklySchedule(next));
  const updateDay = (key: BusinessWeekDayKey, updater: (day: BusinessScheduleDay) => BusinessScheduleDay) => {
    const next = cloneSchedule(schedule);
    next.days[key] = updater(next.days[key]);
    emit(next);
  };

  const applyEveryDay = () => {
    const next = cloneSchedule(schedule);
    for (const key of BUSINESS_WEEK_DAY_KEYS) {
      const current = next.days[key];
      next.days[key] = current.open
        ? current
        : { open: true, allDay: false, slots: DEFAULT_SLOTS.map((slot) => ({ ...slot })) };
    }
    emit(next);
  };

  const applyAroundTheClock = () => {
    const next = cloneSchedule(schedule);
    for (const key of BUSINESS_WEEK_DAY_KEYS) {
      next.days[key] = { open: true, allDay: true, slots: [] };
    }
    emit(next);
  };

  return (
    <div data-business-schedule-editor style={editorStyle}>
      <div style={presetsStyle}>
        <button
          type="button"
          aria-pressed={everyDay}
          onClick={applyEveryDay}
          style={{ ...presetButtonStyle, ...(everyDay ? activePresetStyle : {}) }}
        >
          <span aria-hidden>{everyDay ? "✓" : "○"}</span>
          {t("scheduleEveryDay")}
        </button>
        <button
          type="button"
          aria-pressed={aroundTheClock}
          onClick={applyAroundTheClock}
          style={{ ...presetButtonStyle, ...(aroundTheClock ? activePresetStyle : {}) }}
        >
          <span aria-hidden>{aroundTheClock ? "✓" : "◷"}</span>
          {t("scheduleAlwaysOpen")}
        </button>
      </div>

      <div data-business-schedule-days style={daysGridStyle}>
        {days.map(({ key, label }) => {
          const day = schedule.days[key];
          return (
            <article key={key} data-schedule-day data-open={day.open ? "true" : "false"} style={{ ...dayCardStyle, ...(day.open ? openDayCardStyle : {}) }}>
              <div style={dayHeaderStyle}>
                <strong style={dayNameStyle}>{label}</strong>
                <button
                  type="button"
                  aria-pressed={day.open}
                  onClick={() => updateDay(key, (current) => current.open
                    ? { open: false, allDay: false, slots: [] }
                    : { open: true, allDay: false, slots: DEFAULT_SLOTS.map((slot) => ({ ...slot })) })}
                  style={{ ...dayToggleStyle, ...(day.open ? openDayToggleStyle : {}) }}
                >
                  <span aria-hidden style={toggleDotStyle} />
                  {day.open ? t("scheduleOpen") : t("scheduleClosed")}
                </button>
              </div>

              {day.open ? (
                <div style={dayBodyStyle}>
                  <label style={allDayLabelStyle}>
                    <input
                      type="checkbox"
                      checked={day.allDay}
                      onChange={(event) => updateDay(key, (current) => ({
                        ...current,
                        allDay: event.target.checked,
                        slots: event.target.checked ? [] : current.slots.length ? current.slots : DEFAULT_SLOTS.map((slot) => ({ ...slot })),
                      }))}
                      style={{ accentColor: "#a855f7" }}
                    />
                    {t("scheduleDayAllDay")}
                  </label>

                  {!day.allDay ? (
                    <div style={slotsStyle}>
                      {day.slots.map((slot, slotIndex) => (
                        <div key={`${key}-${slotIndex}`} style={slotRowStyle}>
                          <input
                            type="time"
                            aria-label={`${label} ${t("scheduleStart")}`}
                            value={slot.start}
                            onChange={(event) => updateDay(key, (current) => ({
                              ...current,
                              slots: current.slots.map((item, index) => index === slotIndex ? { ...item, start: event.target.value } : item),
                            }))}
                            style={timeInputStyle}
                          />
                          <span aria-hidden style={timeSeparatorStyle}>→</span>
                          <input
                            type="time"
                            aria-label={`${label} ${t("scheduleEnd")}`}
                            value={slot.end}
                            onChange={(event) => updateDay(key, (current) => ({
                              ...current,
                              slots: current.slots.map((item, index) => index === slotIndex ? { ...item, end: event.target.value } : item),
                            }))}
                            style={timeInputStyle}
                          />
                          {day.slots.length > 1 ? (
                            <button
                              type="button"
                              aria-label={t("scheduleRemoveSlot")}
                              onClick={() => updateDay(key, (current) => ({
                                ...current,
                                slots: current.slots.filter((_, index) => index !== slotIndex),
                              }))}
                              style={removeSlotStyle}
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {day.slots.length < 2 ? (
                        <button
                          type="button"
                          onClick={() => updateDay(key, (current) => ({
                            ...current,
                            slots: [...current.slots, { start: "14:00", end: "18:00" }].slice(0, 2),
                          }))}
                          style={addSlotStyle}
                        >
                          + {t("scheduleAddSlot")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <label style={notesLabelStyle}>
        <span style={notesTitleStyle}>{t("scheduleNotes")}</span>
        <textarea
          value={schedule.notes}
          maxLength={500}
          onChange={(event) => emit({ ...cloneSchedule(schedule), notes: event.target.value })}
          placeholder={t("scheduleNotesPlaceholder")}
          style={notesInputStyle}
        />
      </label>

      <style jsx>{`
        @media (max-width: 760px) {
          div[data-business-schedule-days] {
            grid-template-columns: 1fr !important;
          }
          article[data-schedule-day] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

const editorStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0 };
const presetsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const presetButtonStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, minHeight: 32, padding: "6px 9px", borderRadius: 10, border: "1px solid rgba(167,139,250,0.24)", background: "rgba(124,58,237,0.08)", color: "rgba(255,255,255,0.78)", cursor: "pointer", fontSize: 11, fontWeight: 850 };
const activePresetStyle: CSSProperties = { border: "1px solid rgba(236,72,153,0.40)", background: "linear-gradient(120deg, rgba(14,165,233,0.15), rgba(124,58,237,0.20), rgba(236,72,153,0.15))", color: "white", boxShadow: "0 8px 24px rgba(124,58,237,0.13)" };
const daysGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: 5, minWidth: 0 };
const dayCardStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(155px, .28fr) minmax(0, 1fr)", alignItems: "center", gap: 10, minWidth: 0, minHeight: 42, padding: "6px 8px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(3,9,23,0.26)" };
const openDayCardStyle: CSSProperties = { border: "1px solid rgba(56,189,248,0.20)", background: "linear-gradient(135deg, rgba(14,165,233,0.07), rgba(124,58,237,0.07))" };
const dayHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const dayNameStyle: CSSProperties = { color: "white", fontSize: 12.5, fontWeight: 900 };
const dayToggleStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 25, padding: "4px 7px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 10, fontWeight: 850 };
const openDayToggleStyle: CSSProperties = { border: "1px solid rgba(56,189,248,0.30)", background: "rgba(14,165,233,0.12)", color: "#bae6fd" };
const toggleDotStyle: CSSProperties = { width: 6, height: 6, borderRadius: 999, background: "currentColor", boxShadow: "0 0 10px currentColor" };
const dayBodyStyle: CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 };
const allDayLabelStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, width: "fit-content", flex: "0 0 auto", color: "rgba(255,255,255,0.68)", fontSize: 10, fontWeight: 750, cursor: "pointer", whiteSpace: "nowrap" };
const slotsStyle: CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, minWidth: 0 };
const slotRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "74px auto 74px auto", alignItems: "center", gap: 4 };
const timeInputStyle: CSSProperties = { width: "100%", minWidth: 0, height: 29, boxSizing: "border-box", padding: "3px 5px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(5,13,28,0.72)", color: "white", colorScheme: "dark", fontSize: 11, outline: "none" };
const timeSeparatorStyle: CSSProperties = { color: "rgba(196,181,253,0.72)", fontSize: 11 };
const removeSlotStyle: CSSProperties = { width: 25, height: 25, borderRadius: 8, border: "1px solid rgba(248,113,113,0.18)", background: "rgba(127,29,29,0.12)", color: "#fca5a5", cursor: "pointer", fontSize: 16, lineHeight: 1 };
const addSlotStyle: CSSProperties = { justifySelf: "start", border: 0, background: "transparent", color: "#c4b5fd", padding: "1px 0", cursor: "pointer", fontSize: 10.5, fontWeight: 850 };
const notesLabelStyle: CSSProperties = { display: "grid", gap: 5 };
const notesTitleStyle: CSSProperties = { color: "rgba(255,255,255,0.82)", fontSize: 11.5, fontWeight: 850 };
const notesInputStyle: CSSProperties = { width: "100%", minHeight: 46, maxHeight: 76, resize: "vertical", boxSizing: "border-box", padding: "8px 9px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.11)", background: "rgba(3,9,23,0.30)", color: "white", lineHeight: 1.35, fontSize: 11.5, outline: "none" };
