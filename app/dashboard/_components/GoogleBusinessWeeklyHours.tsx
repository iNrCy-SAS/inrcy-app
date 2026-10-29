"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { GOOGLE_BUSINESS_DAYS, type GoogleBusinessDay, type GoogleBusinessPeriod, type GoogleBusinessTime } from "@/lib/googleBusinessProfile";
import styles from "./GoogleBusinessWeeklyHours.module.css";

type Props = { periods: GoogleBusinessPeriod[]; disabled?: boolean; onChange: (periods: GoogleBusinessPeriod[]) => void };
const timeText = (time: GoogleBusinessTime) => `${String(time.hours ?? 0).padStart(2,"0")}:${String(time.minutes ?? 0).padStart(2,"0")}`;
const parseTime = (text: string): GoogleBusinessTime => { const [hours, minutes] = text.split(":").map(Number); return { hours, minutes }; };
const minutes = (time: GoogleBusinessTime) => (time.hours ?? 0) * 60 + (time.minutes ?? 0);
const nextDay = (day: GoogleBusinessDay) => GOOGLE_BUSINESS_DAYS[(GOOGLE_BUSINESS_DAYS.indexOf(day) + 1) % 7];
const defaultPeriod = (day: GoogleBusinessDay): GoogleBusinessPeriod => ({ openDay: day, closeDay: day, openTime: { hours: 9 }, closeTime: { hours: 18 } });
const allDay = (periods: GoogleBusinessPeriod[]) => periods.length === 1 && minutes(periods[0].openTime) === 0 && ((periods[0].closeDay === nextDay(periods[0].openDay) && minutes(periods[0].closeTime) === 0) || (periods[0].closeDay === periods[0].openDay && minutes(periods[0].closeTime) === 1440));

export default function GoogleBusinessWeeklyHours({ periods, disabled = false, onChange }: Props) {
  const t = useTranslations("dashboard.googleBusinessProfile");
  const [editingDay, setEditingDay] = useState<GoogleBusinessDay | null>(null);
  const [slotIndex, setSlotIndex] = useState(0);
  const [popupHost, setPopupHost] = useState<Element | null>(null);
  const weekRef = useRef<HTMLDivElement>(null);
  const remembered = useRef(new Map<GoogleBusinessDay, GoogleBusinessPeriod[]>());
  const beforeAllDay = useRef(new Map<GoogleBusinessDay, GoogleBusinessPeriod[]>());
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editingDay) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editorRef.current?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [editingDay]);

  function replaceDay(day: GoogleBusinessDay, rows: GoogleBusinessPeriod[]) {
    const first = periods.findIndex(period => period.openDay === day);
    const others = periods.filter(period => period.openDay !== day);
    const insertion = first >= 0 ? first : others.findIndex(period => GOOGLE_BUSINESS_DAYS.indexOf(period.openDay) > GOOGLE_BUSINESS_DAYS.indexOf(day));
    const index = insertion < 0 ? others.length : insertion;
    onChange([...others.slice(0,index), ...rows, ...others.slice(index)]);
  }
  function toggleDay(day: GoogleBusinessDay, open: boolean) {
    const rows = periods.filter(period => period.openDay === day);
    if (!open) { remembered.current.set(day, rows); replaceDay(day, []); }
    else replaceDay(day, remembered.current.get(day)?.length ? remembered.current.get(day)! : [defaultPeriod(day)]);
  }
  function patchTime(day: GoogleBusinessDay, index: number, key: "openTime" | "closeTime", text: string) {
    if (!text) return;
    const rows = periods.filter(period => period.openDay === day);
    replaceDay(day, rows.map((period, position) => {
      if (position !== index) return period;
      const updated = { ...period, [key]: parseTime(text) };
      // Ordinary overnight openings follow Google: an earlier closing time means the next day.
      if (period.closeDay === day || period.closeDay === nextDay(day)) updated.closeDay = minutes(updated.closeTime) <= minutes(updated.openTime) ? nextDay(day) : day;
      return updated;
    }));
  }
  const dayRows = editingDay ? periods.filter(period => period.openDay === editingDay) : [];
  const currentIndex = Math.min(slotIndex, Math.max(0, dayRows.length - 1));
  const current = dayRows[currentIndex];
  const openEditor = (day: GoogleBusinessDay) => { setPopupHost(weekRef.current?.closest("dialog") || null); setSlotIndex(0); setEditingDay(day); };
  const closeEditor = () => setEditingDay(null);

  return <div ref={weekRef} className={styles.week} data-google-weekly-hours>
    <fieldset disabled={disabled || Boolean(editingDay)} className={styles.weekFields}>
      <table className={styles.table} aria-label={t("weeklyHours")}>
        <thead><tr><th scope="col">{t("openDays")}</th><th scope="col">{t("opens")}</th><th scope="col">{t("closes")}</th><th scope="col"><span className={styles.srOnly}>{t("daySlots")}</span></th></tr></thead>
        <tbody>{GOOGLE_BUSINESS_DAYS.map(day => {
          const rows = periods.filter(period => period.openDay === day);
          const first = rows[0];
          const dayLabel = t(`days.${day}`);
          return <tr key={day} data-weekday={day}>
            <th scope="row"><label className={styles.dayLabel}><input type="checkbox" aria-label={`${t("dayOpen")} — ${dayLabel}`} checked={Boolean(first)} onChange={event => toggleDay(day, event.target.checked)} /><span>{dayLabel}</span></label></th>
            {allDay(rows) ? <td colSpan={2}><button type="button" className={styles.allDay} onClick={() => openEditor(day)}>{t("open24Hours")}</button></td> : <><td><input className={styles.time} type="time" aria-label={`${t("opens")} — ${dayLabel}`} value={first ? timeText(first.openTime) : ""} disabled={!first} onChange={event => patchTime(day, 0, "openTime", event.target.value)} /></td><td className={styles.closingCell}><input className={styles.time} type={first?.closeTime.hours === 24 ? "text" : "time"} aria-label={`${t("closes")} — ${dayLabel}`} value={first ? timeText(first.closeTime) : ""} disabled={!first} readOnly={first?.closeTime.hours === 24} onClick={() => { if (first?.closeTime.hours === 24) openEditor(day); }} onChange={event => patchTime(day, 0, "closeTime", event.target.value)} />{first && first.closeDay !== day ? <span className={styles.nextDay} title={t(`days.${first.closeDay}`)}>+1</span> : null}</td></>}
            <td><button type="button" className={styles.more} disabled={!first} aria-label={`${t("daySlots")} — ${dayLabel}`} title={t("daySlots")} onClick={() => openEditor(day)}>{rows.length > 1 ? `+${rows.length - 1}` : "+"}</button></td>
          </tr>;
        })}</tbody>
      </table>
      <p className={styles.hint}>{t("weekHint")}</p>
    </fieldset>
    {editingDay && popupHost ? createPortal(<div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget) closeEditor(); }}><div ref={editorRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${t("daySlots")} — ${t(`days.${editingDay}`)}`} className={styles.dayEditor} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeEditor(); }
      if (event.key === "Tab") { const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,select')).filter(element => !element.matches(':disabled')); const index = controls.indexOf(document.activeElement as HTMLElement); if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1)) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); } }
    }}>
      <header><h4>{t(`days.${editingDay}`)}</h4><button type="button" aria-label={t("closeDayEditor")} onClick={closeEditor}>×</button></header>
      <label className={styles.fullDay}><input type="checkbox" checked={allDay(dayRows)} disabled={disabled} onChange={event => { if (event.target.checked) { beforeAllDay.current.set(editingDay, dayRows); replaceDay(editingDay, [{ openDay: editingDay, openTime: {}, closeDay: nextDay(editingDay), closeTime: {} }]); setSlotIndex(0); } else replaceDay(editingDay, beforeAllDay.current.get(editingDay) || [defaultPeriod(editingDay)]); }} />{t("open24Hours")}</label>
      {!allDay(dayRows) && current ? <><div className={styles.slotNav}><button type="button" aria-label={t("previous")} disabled={currentIndex <= 0 || disabled} onClick={() => setSlotIndex(index => index - 1)}>‹</button><span>{t("periodNumber", { current: currentIndex + 1, total: dayRows.length })}</span><button type="button" aria-label={t("next")} disabled={currentIndex >= dayRows.length - 1 || disabled} onClick={() => setSlotIndex(index => index + 1)}>›</button></div><div className={styles.slotTimes}><label>{t("opens")}<input type="time" value={timeText(current.openTime)} disabled={disabled} onChange={event => patchTime(editingDay, currentIndex, "openTime", event.target.value)} /></label><label>{t("closes")}<input type="time" value={current.closeTime.hours === 24 ? "00:00" : timeText(current.closeTime)} disabled={disabled || current.closeTime.hours === 24} onChange={event => patchTime(editingDay, currentIndex, "closeTime", event.target.value)} /></label></div><label className={styles.fullDay}><input type="checkbox" checked={current.closeTime.hours === 24} disabled={disabled} onChange={event => patchTime(editingDay, currentIndex, "closeTime", event.target.checked ? "24:00" : "00:00")} />{t("midnight")}</label><label>{t("closingDay")}<select value={current.closeDay} disabled={disabled} onChange={event => replaceDay(editingDay, dayRows.map((period, index) => index === currentIndex ? { ...period, closeDay: event.target.value as GoogleBusinessDay } : period))}>{GOOGLE_BUSINESS_DAYS.map(day => <option key={day} value={day}>{t(`days.${day}`)}</option>)}</select></label></> : null}
      <div className={styles.dayActions}><button type="button" disabled={disabled || allDay(dayRows)} onClick={() => { const start = Math.min(21, (dayRows.at(-1)?.closeTime.hours ?? 12) + 1); replaceDay(editingDay, [...dayRows, { openDay: editingDay, closeDay: editingDay, openTime: { hours: start }, closeTime: { hours: Math.min(24,start + 3) } }]); setSlotIndex(dayRows.length); }}>{t("addPeriod")}</button><button type="button" disabled={disabled || !current} onClick={() => { replaceDay(editingDay, dayRows.filter((_, index) => index !== currentIndex)); if (dayRows.length === 1) closeEditor(); }}>{t("removePeriod")}</button></div>
      <button type="button" className={styles.done} onClick={closeEditor}>{t("doneDay")}</button>
    </div></div>, popupHost) : null}
  </div>;
}
