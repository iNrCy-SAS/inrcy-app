"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { stableGoogleBusinessValue, type GoogleBusinessDate, type GoogleBusinessProfile, type GoogleBusinessSpecialPeriod, type GoogleBusinessTime } from "@/lib/googleBusinessProfile";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import GoogleBusinessWeeklyHours from "./GoogleBusinessWeeklyHours";
import styles from "./GoogleBusinessProfileEditor.module.css";

type Snapshot = { accountId: string; accountName: string; locationName: string; version: string; profile: GoogleBusinessProfile; openStatus?: string };
const toTime = (value?: GoogleBusinessTime) => `${String(value?.hours ?? 0).padStart(2, "0")}:${String(value?.minutes ?? 0).padStart(2, "0")}`;
const fromTime = (value: string) => ({ hours: Number(value.split(":")[0]), minutes: Number(value.split(":")[1]) });
const toDate = (value?: GoogleBusinessDate) => value ? `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}` : "";
const fromDate = (value: string) => { const [year, month, day] = value.split("-").map(Number); return { year, month, day }; };
const SECTIONS = ["information", "address", "hours", "exceptions"] as const;

function TimeField({ label, value, disabled, onChange, allowEndOfDay = false }: { label: string; value?: GoogleBusinessTime; disabled: boolean; onChange: (value: GoogleBusinessTime) => void; allowEndOfDay?: boolean }) {
  const endOfDay = value?.hours === 24;
  return <div className={styles.timeField}><label>{label}<input type="time" value={endOfDay ? "00:00" : toTime(value)} required disabled={disabled || endOfDay} onChange={event => { if (event.target.value) onChange(fromTime(event.target.value)); }} /></label>{allowEndOfDay ? <label className={styles.check}><input type="checkbox" disabled={disabled} checked={endOfDay} onChange={event => onChange(event.target.checked ? { hours: 24 } : { hours: 0 })} />24:00</label> : null}</div>;
}

export default function GoogleBusinessProfileEditor({ locationName, onDirtyChange }: { locationName: string; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("dashboard.googleBusinessProfile");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<GoogleBusinessProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const [section, setSection] = useState<typeof SECTIONS[number]>("information");
  const [exceptionPage, setExceptionPage] = useState(0);
  const [changePage, setChangePage] = useState(0);
  const tabId = useId();
  const dirty = Boolean(snapshot && draft && stableGoogleBusinessValue(snapshot.profile) !== stableGoogleBusinessValue(draft));
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController();
    const account = getActiveBrowserUserId();
    setLoading(true); setError(""); setSnapshot(null); setDraft(null); setReview(false);
    void (async () => {
      try {
        const response = await fetch(`/api/integrations/google-business/profile?${new URLSearchParams({ locationName })}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.user_message || data.error || t("loadError"));
        if (controller.signal.aborted || account !== getActiveBrowserUserId()) return;
        setSnapshot(data); setDraft(data.profile);
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t("loadError")); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [locationName, retry, t]);
  const changes = useMemo(() => snapshot && draft ? (Object.keys(draft) as Array<keyof GoogleBusinessProfile>).filter(key => stableGoogleBusinessValue(snapshot.profile[key]) !== stableGoogleBusinessValue(draft[key])) : [], [snapshot, draft]);
  const update = <K extends keyof GoogleBusinessProfile>(key: K, value: GoogleBusinessProfile[K]) => { setDraft(current => current ? { ...current, [key]: value } : current); setReview(false); setSaved(false); setError(""); };
  const updateSpecial = (index: number, patch: Partial<GoogleBusinessSpecialPeriod>) => update("specialHours", { specialHourPeriods: draft!.specialHours.specialHourPeriods.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const label = (key: keyof GoogleBusinessProfile) => t(`fields.${key}`);
  const describe = (profile: GoogleBusinessProfile, key: keyof GoogleBusinessProfile): string => {
    const value = profile[key];
    if (typeof value === "string") return value || t("empty");
    if (key === "storefrontAddress") { const address = profile.storefrontAddress; return address ? [...(address.addressLines || []), address.postalCode, address.locality, address.regionCode].filter(Boolean).join(", ") : t("empty"); }
    if (key === "regularHours") return profile.regularHours.periods.map(row => `${t(`days.${row.openDay}`)} ${toTime(row.openTime)} → ${t(`days.${row.closeDay}`)} ${toTime(row.closeTime)}`).join("\n") || t("empty");
    return profile.specialHours.specialHourPeriods.map(row => `${toDate(row.startDate)} : ${row.closed ? t("closed") : `${toTime(row.openTime)} → ${toDate(row.endDate || row.startDate)} ${toTime(row.closeTime)}`}`).join("\n") || t("empty");
  };
  async function save() {
    if (!snapshot || !draft || saving || !dirty) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/integrations/google-business/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: snapshot.accountId, accountName: snapshot.accountName, locationName: snapshot.locationName, version: snapshot.version, profile: draft }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.user_message || data.error || t("saveError"));
      if (snapshot.accountId !== getActiveBrowserUserId()) return;
      setSnapshot(current => current ? { ...current, profile: data.profile, version: data.version } : current);
      setDraft(data.profile); setReview(false); setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("saveError")); }
    finally { setSaving(false); }
  }
  if (loading) return <p role="status">{t("loading")}</p>;
  if (!snapshot || !draft) return <div className={styles.editor}><p role="alert">{error || t("loadError")}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{t("retry")}</button></div>;
  const exceptionIndex = Math.min(exceptionPage, Math.max(0, draft.specialHours.specialHourPeriods.length - 1));
  const exception = draft.specialHours.specialHourPeriods[exceptionIndex];
  const changeIndex = Math.min(changePage, Math.max(0, changes.length - 1));
  const changeKey = changes[changeIndex];
  const pager = (position: number, count: number, onChange: (index: number) => void) => <div className={styles.pager}><button type="button" aria-label={t("previous")} disabled={saving || position <= 0} onClick={() => onChange(position - 1)}>‹</button><span aria-live="polite">{count ? position + 1 : 0} / {count}</span><button type="button" aria-label={t("next")} disabled={saving || position >= count - 1} onClick={() => onChange(position + 1)}>›</button></div>;
  return <form className={styles.editor} onSubmit={event => { event.preventDefault(); setChangePage(0); setReview(true); }} aria-busy={saving}>
    <header className={styles.intro}><div><p>{t("selectedEstablishment")}</p><h3>{snapshot.profile.title}</h3></div><span>{t("googleBusiness")}</span></header>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {saved ? <p className={styles.success} role="status">{t("saved")}</p> : null}
    {review ? <>
      <section className={styles.section} aria-label={t("reviewTitle")}><div className={styles.sectionTop}><h3>{t("reviewTitle")}</h3>{pager(changeIndex, changes.length, setChangePage)}</div><p>{t("reviewHint")}</p>
      {changeKey ? <div className={styles.change}><h4>{label(changeKey)}</h4><div className={styles.comparison}><label>{t("before")}<textarea rows={4} readOnly value={describe(snapshot.profile, changeKey)} /></label><label>{t("after")}<textarea rows={4} readOnly value={describe(draft, changeKey)} /></label></div></div> : null}
      {changes.includes("title") || changes.includes("storefrontAddress") ? <p>{t("identityReview")}</p> : null}</section>
      <footer className={styles.footer}><div className={styles.actions}><button type="button" disabled={saving} onClick={() => setReview(false)}>{t("back")}</button><button className={styles.primary} type="button" disabled={saving || !dirty} onClick={() => void save()}>{saving ? t("saving") : t("saveGoogle")}</button></div></footer>
    </> : <>
      <div className={styles.tabs} role="tablist" aria-label={t("editSections")}>{SECTIONS.map((key, index) => <button key={key} id={`${tabId}-${key}`} type="button" role="tab" aria-selected={section === key} aria-controls={`${tabId}-panel`} tabIndex={section === key ? 0 : -1} disabled={saving} onClick={() => setSection(key)} onKeyDown={event => { const next = event.key === "ArrowRight" ? (index + 1) % SECTIONS.length : event.key === "ArrowLeft" ? (index + SECTIONS.length - 1) % SECTIONS.length : event.key === "Home" ? 0 : event.key === "End" ? SECTIONS.length - 1 : -1; if (next < 0) return; event.preventDefault(); setSection(SECTIONS[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }}>{t(`tabs.${key}`)}</button>)}</div>
      <section id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${section}`} className={`${styles.section} ${section === "hours" ? styles.hoursSection : ""}`}>
      {section === "information" ? <div className={`${styles.fields} ${styles.informationFields}`}>
        <label>{label("title")}<input value={draft.title} maxLength={200} required disabled={saving} onChange={event => update("title", event.target.value)} autoComplete="organization" /></label>
        <label>{label("primaryPhone")}<input type="tel" value={draft.primaryPhone} maxLength={50} disabled={saving} onChange={event => update("primaryPhone", event.target.value)} autoComplete="tel" /></label>
        <label className={styles.wide}>{label("websiteUri")}<input type="url" value={draft.websiteUri} maxLength={2048} placeholder="https://" disabled={saving} onChange={event => update("websiteUri", event.target.value)} /></label>
        <label className={`${styles.wide} ${styles.descriptionField}`}>{label("description")}<textarea value={draft.description} maxLength={750} rows={3} disabled={saving} onChange={event => update("description", event.target.value)} /><small>{draft.description.length} / 750</small></label>
      </div> : null}
      {section === "address" ? draft.storefrontAddress ? <div className={styles.fields}>
        <label className={styles.wide}>{t("addressLines")}<textarea rows={2} value={(draft.storefrontAddress.addressLines || []).join("\n")} disabled={saving} onChange={event => update("storefrontAddress", { ...draft.storefrontAddress, addressLines: event.target.value.split("\n") })} /></label>
        {(["postalCode", "locality", "administrativeArea", "regionCode"] as const).map(key => <label key={key}>{t(key)}<input value={String(draft.storefrontAddress?.[key] || "")} maxLength={key === "regionCode" ? 2 : 200} disabled={saving} onChange={event => update("storefrontAddress", { ...draft.storefrontAddress, [key]: key === "regionCode" ? event.target.value.toUpperCase() : event.target.value })} /></label>)}
      </div> : <p>{t("hiddenAddress")}</p> : null}
      {section === "hours" ? <GoogleBusinessWeeklyHours periods={draft.regularHours.periods} disabled={saving} onChange={periods => update("regularHours", { periods })} /> : null}
      {section === "exceptions" ? <><div className={styles.sectionTop}><p>{t("specialHint")}</p>{pager(exceptionIndex, draft.specialHours.specialHourPeriods.length, setExceptionPage)}</div>
        {exception ? <div className={styles.fields}><label>{t("date")}<input type="date" value={toDate(exception.startDate)} required disabled={saving} onChange={event => { if (event.target.value) updateSpecial(exceptionIndex, { startDate: fromDate(event.target.value), endDate: fromDate(event.target.value) }); }} /></label><label className={styles.check}><input type="checkbox" checked={Boolean(exception.closed)} disabled={saving} onChange={event => updateSpecial(exceptionIndex, { closed: event.target.checked, openTime: exception.openTime || { hours: 9 }, closeTime: exception.closeTime || { hours: 18 } })} />{t("closedAllDay")}</label>{!exception.closed ? <><TimeField label={t("opens")} value={exception.openTime} disabled={saving} onChange={value => updateSpecial(exceptionIndex, { openTime: value })} /><TimeField label={t("closes")} value={exception.closeTime} disabled={saving} allowEndOfDay onChange={value => updateSpecial(exceptionIndex, { closeTime: value })} /><label className={styles.wide}>{t("endDate")}<input type="date" value={toDate(exception.endDate || exception.startDate)} required disabled={saving} onChange={event => { if (event.target.value) updateSpecial(exceptionIndex, { endDate: fromDate(event.target.value) }); }} /></label></> : null}</div> : <p className={styles.empty}>{t("noExceptions")}</p>}
        <div className={styles.rowActions}><button type="button" disabled={saving} onClick={() => { const now = new Date(); update("specialHours", { specialHourPeriods: [...draft.specialHours.specialHourPeriods, { startDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }, closed: true }] }); setExceptionPage(draft.specialHours.specialHourPeriods.length); }}>{t("addException")}</button>{exception ? <button type="button" disabled={saving} onClick={() => update("specialHours", { specialHourPeriods: draft.specialHours.specialHourPeriods.filter((_, i) => i !== exceptionIndex) })}>{t("removeException")}</button> : null}</div></> : null}
      </section>
      <footer className={styles.footer}><span>{dirty ? t("unsaved") : t("upToDate")}</span><div className={styles.actions}><button type="button" disabled={!dirty || saving} onClick={() => { setDraft(structuredClone(snapshot.profile)); setError(""); }}>{t("reset")}</button><button className={styles.primary} type="submit" disabled={!dirty || saving}>{t("reviewChanges")}</button></div></footer>
    </>}
  </form>;
}
