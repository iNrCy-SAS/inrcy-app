"use client";

import { useTranslations } from "next-intl";


import Image from "next/image";
import inrCalendarLogo from "@/public/inrcalendar-logo.png";
import { useMemo, useState, type FormEvent } from "react";
import { getInrBadgeAppointmentDaySlots, type InrBadgeAppointmentSettings } from "@/lib/inrBadgeSettings";
import { getInrBadgeLocale, getInrBadgeTexts, normalizeInrBadgeLanguage, type InrBadgeLanguageCode } from "@/lib/inrBadgeLanguage";
import styles from "../badge.module.css";

type BusyEvent = { id: string; start: string; end: string };

type Props = {
  slug: string;
  settings: InrBadgeAppointmentSettings;
  events: BusyEvent[];
  language?: InrBadgeLanguageCode;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesFromTime(value: string) {
  const [h, m] = value.split(":").map((item) => Number(item));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function timeFromMinutes(value: number) {
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function formatDayLabel(date: Date, language: InrBadgeLanguageCode) {
  return new Intl.DateTimeFormat(getInrBadgeLocale(language), { weekday: "short", day: "2-digit", month: "short" }).format(date);
}

function buildLocalDateTime(dateKeyValue: string, time: string) {
  return new Date(`${dateKeyValue}T${time}:00`);
}


function overlaps(start: Date, end: Date, event: BusyEvent) {
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);
  if (!Number.isFinite(eventStart.getTime()) || !Number.isFinite(eventEnd.getTime())) return false;
  return start < eventEnd && end > eventStart;
}

export default function RdvBookingClient({ slug, settings, events, language }: Props) {
  const i18nT = useTranslations("public");
  const badgeLanguage = normalizeInrBadgeLanguage(language);
  const badgeText = getInrBadgeTexts(badgeLanguage);
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string; label: string } | null>(null);
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const now = new Date();
    const items: Array<{ key: string; label: string }> = [];
    for (let offset = 0; offset < settings.daysAhead; offset += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() + offset);
      const weekday = date.getDay();
      const daySlots = getInrBadgeAppointmentDaySlots(settings, weekday);
      if (!daySlots.length) continue;
      items.push({ key: dateKey(date), label: formatDayLabel(date, badgeLanguage) });
    }
    return items;
  }, [settings, badgeLanguage]);

  const activeDay = selectedDay || days[0]?.key || "";

  const slots = useMemo(() => {
    if (!activeDay) return [];
    const weekday = new Date(`${activeDay}T12:00:00`).getDay();
    const daySlots = getInrBadgeAppointmentDaySlots(settings, weekday);
    const minDate = new Date(Date.now() + settings.minNoticeHours * 60 * 60 * 1000);
    const output: Array<{ start: string; end: string; label: string }> = [];

    for (const slot of daySlots) {
      const startMinutes = minutesFromTime(slot.startTime);
      const endMinutes = minutesFromTime(slot.endTime);
      const duration = slot.durationMinutes;

      for (let cursor = startMinutes; cursor + duration <= endMinutes; cursor += duration) {
        const startTime = timeFromMinutes(cursor);
        const endTime = timeFromMinutes(cursor + duration);
        const start = buildLocalDateTime(activeDay, startTime);
        const end = buildLocalDateTime(activeDay, endTime);
        if (start < minDate) continue;
        if (events.some((event) => overlaps(start, end, event))) continue;
        output.push({ start: start.toISOString(), end: end.toISOString(), label: startTime });
      }
    }

    return output;
  }, [activeDay, settings, events]);

  const slotValue = selectedSlot?.start || "";

  function handleClosePage() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed && document.visibilityState === "visible") {
        window.history.back();
      }
    }, 120);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFeedback(null);

    if (!selectedSlot) {
      setError(badgeText.rdvChooseSlotError);
      return;
    }
    if (!name.trim() || !email.trim()) {
      setError(badgeText.rdvRequiredError);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inrbadge/appointment-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          start: selectedSlot.start,
          end: selectedSlot.end,
          name,
          company: companyName,
          email,
          phone,
          message: message.trim(),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(badgeText.rdvGenericError);
      setFeedback(badgeText.rdvSuccess);
      setSelectedSlot(null);
      setName("");
      setCompanyName("");
      setEmail("");
      setPhone("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : badgeText.rdvGenericError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.calendarHeader}>
            <div className={styles.calendarTopBar}>
              <div className={styles.rdvTopActions}>
                <a className={`${styles.previousPageButton} ${styles.iconActionButton}`} href={`/badge/${slug}`} aria-label={badgeText.rdvBack} title={badgeText.rdvBack}>←</a>
                <button type="button" className={`${styles.closePageButton} ${styles.iconActionButton}`} onClick={handleClosePage} aria-label={badgeText.close} title={badgeText.close}>×</button>
              </div>
              <Image className={styles.calendarHeroLogo} src={inrCalendarLogo} alt={i18nT("inr_calendar_f5f54ab6")} width={168} height={64} priority />
            </div>
            <p className={styles.calendarInlineInfo}>{badgeText.rdvTitle}</p>
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionMark} />
              <h2>{badgeText.rdvChooseSlot}</h2>
            </div>

            <div className={styles.rdvSelectGrid}>
              <label>
                {badgeText.rdvDate}
                <select
                  value={activeDay}
                  onChange={(event) => {
                    setSelectedDay(event.target.value);
                    setSelectedSlot(null);
                  }}
                >
                  {days.map((day) => (
                    <option key={day.key} value={day.key}>{day.label}</option>
                  ))}
                </select>
              </label>

              <label>
                {badgeText.rdvTime}
                <select
                  value={slotValue}
                  onChange={(event) => {
                    const nextSlot = slots.find((slot) => slot.start === event.target.value) || null;
                    setSelectedSlot(nextSlot);
                  }}
                  disabled={!slots.length}
                >
                  <option value="">{slots.length ? badgeText.rdvChooseTime : badgeText.rdvNoSlot}</option>
                  {slots.map((slot) => (
                    <option key={slot.start} value={slot.start}>{slot.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {!slots.length ? <p className={styles.emptySlots}>{badgeText.rdvNoSlotDay}</p> : null}
          </section>

          <form className={styles.rdvForm} onSubmit={submitRequest}>
            <div className={styles.rdvFieldGrid}>
              <label>
                {badgeText.rdvNameLabel}
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder={badgeText.rdvNamePlaceholder} />
              </label>
              <label>
                {badgeText.rdvCompanyLabel}
                <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder={badgeText.rdvCompanyPlaceholder} />
              </label>
            </div>

            <div className={styles.rdvFieldGrid}>
              <label>
                {badgeText.rdvMailLabel}
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={badgeText.rdvEmailPlaceholder} />
              </label>
              <label>
                {badgeText.rdvPhoneLabel}
                <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={badgeText.rdvPhonePlaceholder} />
              </label>
            </div>

            <label>
              {badgeText.rdvMessageLabel}
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={badgeText.rdvMessagePlaceholder} rows={3} />
            </label>

            {error ? <div className={styles.rdvError}>{error}</div> : null}
            {feedback ? <div className={styles.rdvSuccess}>{feedback}</div> : null}

            <button type="submit" className={styles.rdvSubmit} disabled={submitting || !selectedSlot}>
              {submitting ? badgeText.rdvSubmitting : badgeText.rdvSubmit}
            </button>
            <p className={styles.rdvNote}>{badgeText.rdvNote}</p>
          </form>
        </div>

        <div className={styles.footer}>{badgeText.poweredBy} <strong>{i18nT("inrcy_ef95fe0e")}</strong></div>
      </section>
    </main>
  );
}
