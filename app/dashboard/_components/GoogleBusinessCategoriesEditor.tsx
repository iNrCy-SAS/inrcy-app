"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import type { GoogleBusinessCategories, GoogleBusinessCategory } from "@/lib/googleBusinessProfile";
import styles from "./GoogleBusinessProfileEditor.module.css";

type Context = { accountId: string; locationName: string };
type PickerProps = {
  context: Context; value: GoogleBusinessCategory | null; label: string; disabled: boolean;
  excludedNames: string[]; onSelect: (category: GoogleBusinessCategory) => void; onPendingChange: (pending: boolean) => void;
};

export function GoogleBusinessCategoryPicker({ context, value, label, disabled, excludedNames, onSelect, onPendingChange }: PickerProps) {
  const t = useTranslations("dashboard.googleBusinessProfile.categories");
  const locale = useLocale();
  const id = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [options, setOptions] = useState<GoogleBusinessCategory[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pageToken, setPageToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const search = query?.trim() ?? "";
  const pending = query !== null && (value ? search !== value.displayName : search.length > 0);
  const matches = options.filter(category => !excludedNames.includes(category.name));
  useEffect(() => { onPendingChange(pending); return () => onPendingChange(false); }, [pending, onPendingChange]);
  useEffect(() => {
    const controller = new AbortController();
    if (disabled || query === null || search.length < 2) return () => controller.abort();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      void (async () => {
        try {
          const params = new URLSearchParams({ accountId: context.accountId, locationName: context.locationName, languageCode: locale, q: search, ...(pageToken ? { pageToken } : {}) });
          const response = await fetch(`/api/integrations/google-business/categories?${params}`, { cache: "no-store", signal: controller.signal });
          const data = await response.json();
          if (controller.signal.aborted || getActiveBrowserUserId() !== context.accountId) return;
          if (!response.ok || !data.ok) throw new Error(data.user_message || t("error"));
          if (data.accountId !== context.accountId || data.locationName !== context.locationName) throw new Error(t("error"));
          if (!Array.isArray(data.categories)) throw new Error(t("error"));
          setOptions(current => pageToken ? [...current, ...data.categories.filter((category: GoogleBusinessCategory) => !current.some(item => item.name === category.name))] : data.categories);
          setNextPageToken(data.nextPageToken || null);
          setActiveIndex(-1);
        } catch (caught) {
          if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t("error"));
        } finally { if (!controller.signal.aborted) setLoading(false); }
      })();
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [context.accountId, context.locationName, disabled, locale, pageToken, query, search, t]);
  const close = () => { setQuery(null); setOptions([]); setPageToken(""); setNextPageToken(null); setError(""); setLoading(false); setActiveIndex(-1); };
  const select = (category: GoogleBusinessCategory) => {
    if (disabled || getActiveBrowserUserId() !== context.accountId || excludedNames.includes(category.name)) return;
    onSelect(category); close();
  };
  return <div className={styles.categoryPicker}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.categoryInput}>
      <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={query !== null && search.length >= 2}
        aria-controls={`${id}-options`} aria-activedescendant={activeIndex >= 0 && matches[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
        autoComplete="off" maxLength={80} disabled={disabled} placeholder={t("placeholder")} value={query ?? value?.displayName ?? ""}
        onChange={event => { setQuery(event.target.value); setPageToken(""); setOptions([]); setNextPageToken(null); setActiveIndex(-1); setError(""); setLoading(false); }}
        onKeyDown={event => {
          if (query === null) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => matches.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : -1); }
          if (event.key === "Enter") { event.preventDefault(); if (matches[activeIndex]) select(matches[activeIndex]); }
        }} />
      {query !== null ? <button type="button" aria-label={t("cancelSearch")} disabled={disabled} onClick={close}>×</button> : null}
    </div>
    {query !== null && search.length >= 2 ? <div className={styles.categorySuggestions}>
      {loading ? <p role="status">{t("searching")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul id={`${id}-options`} role="listbox" aria-label={label}>
        {matches.map((category, index) => <li key={category.name} id={`${id}-option-${index}`} role="option" aria-selected={activeIndex === index}>
          <button type="button" disabled={disabled || loading} onClick={() => select(category)}>{category.displayName}</button>
        </li>)}
      </ul>
      {!loading && !error && !matches.length ? <p>{t("noResults")}</p> : null}
      {nextPageToken && !error ? <button type="button" disabled={loading || disabled} onClick={() => setPageToken(nextPageToken)}>{t("more")}</button> : null}
    </div> : null}
  </div>;
}

export default function GoogleBusinessCategoriesEditor({ context, value, disabled, onChange, onPendingChange }: {
  context: Context; value: GoogleBusinessCategories; disabled: boolean;
  onChange: (value: GoogleBusinessCategories) => void; onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations("dashboard.googleBusinessProfile.categories");
  const [primaryPending, setPrimaryPending] = useState(false);
  const [additionalPending, setAdditionalPending] = useState(false);
  const primarySearchChanged = useCallback((pending: boolean) => setPrimaryPending(pending), []);
  const additionalSearchChanged = useCallback((pending: boolean) => setAdditionalPending(pending), []);
  useEffect(() => { onPendingChange(primaryPending || additionalPending); return () => onPendingChange(false); }, [primaryPending, additionalPending, onPendingChange]);
  return <div className={`${styles.wide} ${styles.categoryFields}`}>
    <GoogleBusinessCategoryPicker context={context} value={value.primaryCategory} label={t("primary")} disabled={disabled} excludedNames={[]}
      onPendingChange={primarySearchChanged} onSelect={primaryCategory => onChange({ primaryCategory, additionalCategories: value.additionalCategories.filter(category => category.name !== primaryCategory.name) })} />
    <div>
      <GoogleBusinessCategoryPicker context={context} value={null} label={t("additional")} disabled={disabled || value.additionalCategories.length >= 9}
        excludedNames={[value.primaryCategory?.name ?? "", ...value.additionalCategories.map(category => category.name)]}
        onPendingChange={additionalSearchChanged} onSelect={category => onChange({ ...value, additionalCategories: [...value.additionalCategories, category] })} />
      {value.additionalCategories.length ? <ul className={styles.categoryTags}>{value.additionalCategories.map(category => <li key={category.name}>
        <span>{category.displayName}</span><button type="button" disabled={disabled} aria-label={t("remove", { name: category.displayName })}
          onClick={() => onChange({ ...value, additionalCategories: value.additionalCategories.filter(item => item.name !== category.name) })}>×</button>
      </li>)}</ul> : null}
    </div>
    <p className={styles.categoryHint}>{primaryPending || additionalPending ? t("selectResult") : value.additionalCategories.length >= 9 ? t("maximum") : t("hint")}</p>
  </div>;
}
