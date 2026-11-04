"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import {
  normalizeInrSearchDisplaySettings,
  normalizeInrSearchSections,
  type InrSearchDisplaySettings,
  type InrSearchSections,
} from "@/lib/inrSearchDisplaySettings";
import { useDashboardUnsavedNavigation } from "../../_components/DashboardUnsavedNavigationProvider";
import styles from "./InrSearchPresentationSettings.module.css";

type Tab = "contact" | "sections" | "texts";
type Presentation = {
  accountId: string;
  display: InrSearchDisplaySettings;
  sections: InrSearchSections;
  pageTitleOverride: string;
  pageDescriptionOverride: string;
};

function readPresentation(value: unknown, accountId: string | null): Presentation | null {
  if (!accountId || !value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.ok !== true || raw.accountId !== accountId || !raw.inrSearch || typeof raw.inrSearch !== "object") return null;
  const settings = raw.inrSearch as Record<string, unknown>;
  return {
    accountId,
    display: normalizeInrSearchDisplaySettings(settings.display),
    sections: normalizeInrSearchSections(settings.sections),
    pageTitleOverride: typeof settings.pageTitleOverride === "string" ? settings.pageTitleOverride.slice(0, 160) : "",
    pageDescriptionOverride: typeof settings.pageDescriptionOverride === "string" ? settings.pageDescriptionOverride.slice(0, 500) : "",
  };
}

function TabIcon({ tab }: { tab: Tab }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tab === "contact" ? <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></> : tab === "sections" ? <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></> : <><path d="M4 5h16M12 5v15M8 20h8M4 9V5m16 4V5" /></>}
  </svg>;
}

export default function InrSearchPresentationSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const t = useTranslations("dashboard.inrSearchPresentation");
  const router = useRouter();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const id = useId();
  const [tab, setTab] = useState<Tab>("contact");
  const [draft, setDraft] = useState<Presentation | null>(null);
  const [saved, setSaved] = useState<Presentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveComplete, setSaveComplete] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const saving = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(saved));

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    const accountId = getActiveBrowserUserId();
    loadController.current?.abort();
    saveController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    saving.current = false;
    setDraft(null); setSaved(null); setLoading(true); setBusy(false); setError(""); setSaveComplete(false);
    const current = () => mounted.current && !controller.signal.aborted && sequence === generation.current && accountId === getActiveBrowserUserId();
    try {
      const response = await fetch("/api/inr-search/settings", { cache: "no-store", credentials: "include", signal: controller.signal });
      const raw: unknown = await response.json();
      if (!current()) return;
      const next = response.ok ? readPresentation(raw, accountId) : null;
      if (!next) throw new Error("load");
      setDraft(next); setSaved(next);
    } catch { if (current()) setError(t("loadFailed")); }
    finally { if (current()) setLoading(false); }
  }, [t]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const reload = () => { void load(); };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, reload);
    return () => {
      mounted.current = false;
      loadController.current?.abort(); saveController.current?.abort();
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, reload);
    };
  }, [load]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const save = async () => {
    if (!draft || loading || saving.current || !dirty) return;
    if (draft.accountId !== getActiveBrowserUserId()) { setError(t("accountChanged")); return; }
    const submitted = draft;
    const sequence = generation.current;
    const controller = new AbortController();
    saveController.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && sequence === generation.current && submitted.accountId === getActiveBrowserUserId();
    saving.current = true; setBusy(true); setError(""); setSaveComplete(false);
    try {
      const response = await fetch("/api/inr-search/settings", { method: "POST", credentials: "include", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "presentation", ...submitted }) });
      const raw: unknown = await response.json();
      if (!current()) return;
      const next = response.ok ? readPresentation(raw, submitted.accountId) : null;
      if (!next) throw new Error("save");
      setDraft(next); setSaved(next); setSaveComplete(true);
      window.dispatchEvent(new CustomEvent("inrcy:inr-search-settings-updated", { detail: { accountId: submitted.accountId } }));
    } catch { if (current()) setError(t("saveFailed")); }
    finally { if (sequence === generation.current) { saving.current = false; if (current()) setBusy(false); } }
  };
  const change = (next: Presentation) => { setDraft(next); setSaveComplete(false); setError(""); };
  const navigate = (section: "company" | "communication") => { void requestNavigation(() => router.push(`/dashboard/personnalisation?section=${section}`)); };
  const displayGroups: Array<{ heading: "contactHeading" | "linksHeading"; keys: Array<keyof InrSearchDisplaySettings> }> = [
    { heading: "contactHeading", keys: ["phone", "email", "address", "contactName"] },
    { heading: "linksHeading", keys: ["logo", "badge", "website", "socials"] },
  ];
  const sectionKeys: Array<keyof InrSearchSections> = ["identity", "presentation", "contact", "hours", "services", "sectors", "areas", "media", "news", "socials", "faq", "trust", "cta"];
  const tabs = [{ key: "contact", label: "contactTab" }, { key: "sections", label: "sectionsTab" }, { key: "texts", label: "textsTab" }] as const;

  return <div className={styles.panel} data-inr-search-presentation>
    <p className={styles.lead}>{t("lead")}</p>
    <div className={styles.tabs} role="tablist" aria-label={t("tabsLabel")}>
      {tabs.map((item, index) => <button key={item.key} id={`${id}-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls={`${id}-panel`} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={event => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault(); setTab(tabs[next].key); document.getElementById(`${id}-${tabs[next].key}`)?.focus();
      }}><span className={styles.tabIcon} data-tab={item.key}><TabIcon tab={item.key} /></span><span>{t(item.label)}</span></button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className={styles.body} aria-busy={loading}>
      {loading ? <div className={styles.loading} role="status">{t("loading")}</div> : !draft ? <div className={styles.loadError}><p role="alert">{error || t("loadFailed")}</p><button type="button" onClick={() => void load()}>{t("retry")}</button></div> : <>
        {tab === "contact" ? <div className={styles.contactGrid}>{displayGroups.map(group => <section key={group.heading} className={styles.card}><h3>{t(group.heading)}</h3><div className={styles.toggleList}>{group.keys.map(key => <label key={key} className={styles.toggleRow}><span>{t(key)}</span><input type="checkbox" role="switch" checked={draft.display[key]} disabled={busy} onChange={event => change({ ...draft, display: { ...draft.display, [key]: event.currentTarget.checked } })} /></label>)}</div></section>)}</div> : null}
        {tab === "sections" ? <section className={styles.card}><h3>{t("sectionsHeading")}</h3><div className={styles.sectionsGrid}>{sectionKeys.map(key => <label key={key} className={styles.toggleRow}><span>{t(key)}</span><input type="checkbox" role="switch" checked={draft.sections[key]} disabled={busy} onChange={event => change({ ...draft, sections: { ...draft.sections, [key]: event.currentTarget.checked } })} /></label>)}</div></section> : null}
        {tab === "texts" ? <section className={`${styles.card} ${styles.textCard}`}><h3>{t("textsHeading")}</h3><label className={styles.textField}><span>{t("pageTitle")}<small>{draft.pageTitleOverride.length}/160</small></span><input type="text" value={draft.pageTitleOverride} maxLength={160} placeholder={t("titlePlaceholder")} disabled={busy} onChange={event => change({ ...draft, pageTitleOverride: event.currentTarget.value })} /></label><label className={styles.textField}><span>{t("pageDescription")}<small>{draft.pageDescriptionOverride.length}/500</small></span><textarea value={draft.pageDescriptionOverride} maxLength={500} rows={5} placeholder={t("descriptionPlaceholder")} disabled={busy} onChange={event => change({ ...draft, pageDescriptionOverride: event.currentTarget.value })} /></label><p className={styles.hint}>{t("automaticHint")}</p></section> : null}
        <div className={styles.sourceLinks}><button type="button" onClick={() => navigate("company")}>{t("editCompany")} <span aria-hidden="true">→</span></button><button type="button" onClick={() => navigate("communication")}>{t("editCommunication")} <span aria-hidden="true">→</span></button></div>
      </>}
    </div>
    <footer className={styles.footer}><p className={styles.hint}>{t("googleCacheHint")}</p><div className={styles.saveActions}>{draft && error ? <span className={styles.error} role="alert">{error}</span> : null}{saveComplete && !dirty ? <span className={styles.saved} role="status">{t("saved")}</span> : null}<button type="button" className={styles.saveButton} onClick={() => void save()} disabled={!draft || loading || busy || !dirty} aria-busy={busy}>{t(busy ? "saving" : "save")}</button></div></footer>
  </div>;
}
