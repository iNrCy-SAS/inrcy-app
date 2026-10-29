"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { PUBLIC_PROFILE_DATA_SAVED_EVENT, refreshPublicProfileDependents } from "@/lib/publicProfileRefreshClient";
import styles from "./BusinessLocationFields.module.css";

type BusinessLocation = { postalCode: string; city: string };
type ContentLocation = { useHeadquarters: boolean; primaryArea: string };
type Props = {
  value: ContentLocation;
  onChange: (value: ContentLocation) => void;
  disabled?: boolean;
  onUnsavedChange?: (dirty: boolean, signature: string) => void;
};

export type BusinessLocationFieldsHandle = {
  isReady: () => boolean;
  canAutoSave: () => boolean;
  save: () => Promise<boolean>;
  cancelChanges: () => void;
};

const EMPTY_LOCATION: BusinessLocation = { postalCode: "", city: "" };
const SOURCE_LABELS: Record<string, string> = {
  google_business: "Google Business", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn",
  threads: "Threads", x: "X", twitter: "X", youtube: "YouTube", tiktok: "TikTok", pinterest: "Pinterest",
};

function locationSignature(location: BusinessLocation) {
  return JSON.stringify(location);
}

function parseLocation(payload: unknown): { accountId: string; location: BusinessLocation; source: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const result = payload as Record<string, unknown>;
  const location = result.location as Record<string, unknown> | undefined;
  if (result.ok !== true || typeof result.accountId !== "string" || !location) return null;
  if (typeof location.postalCode !== "string" || typeof location.city !== "string") return null;
  return {
    accountId: result.accountId,
    location: { postalCode: location.postalCode, city: location.city },
    source: typeof result.source === "string" ? result.source : "",
  };
}

const BusinessLocationFields = forwardRef<BusinessLocationFieldsHandle, Props>(function BusinessLocationFields(
  { value, onChange, disabled = false, onUnsavedChange },
  ref,
) {
  const t = useTranslations("dashboard.aiMemory");
  const inputId = useId();
  const [draft, setDraft] = useState<BusinessLocation>(EMPTY_LOCATION);
  const [loading, setLoading] = useState(true);
  const [autofilling, setAutofilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const draftRef = useRef(EMPTY_LOCATION);
  const persistedRef = useRef(EMPTY_LOCATION);
  const accountRef = useRef("");
  const browserScopeRef = useRef("");
  const dirtyRef = useRef(false);
  const loadingRef = useRef(true);
  const savingRef = useRef(false);
  const saveVersionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const autofillAccountsRef = useRef(new Set<string>());

  const publishDraft = useCallback((next: BusinessLocation) => {
    draftRef.current = next;
    setDraft(next);
    const signature = locationSignature(next);
    dirtyRef.current = signature !== locationSignature(persistedRef.current);
    onUnsavedChange?.(dirtyRef.current, signature);
  }, [onUnsavedChange]);

  useEffect(() => {
    let active = true;
    let requestVersion = 0;
    let controller: AbortController | null = null;

    const load = async (resetForAccount = false) => {
      if (!resetForAccount && (dirtyRef.current || savingRef.current)) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const version = ++requestVersion;
      const browserScope = getActiveBrowserUserId() || "";
      browserScopeRef.current = browserScope;
      loadingRef.current = true;
      setLoading(true);
      setAutofilling(false);
      setError("");
      if (resetForAccount) {
        saveVersionRef.current += 1;
        savingRef.current = false;
        setSaving(false);
        accountRef.current = "";
        persistedRef.current = EMPTY_LOCATION;
        publishDraft(EMPTY_LOCATION);
        setSource("");
      }
      const stillCurrent = (accountId?: string) => active && !signal.aborted && version === requestVersion
        && (getActiveBrowserUserId() || "") === browserScope
        && (!accountId || !browserScope || accountId === browserScope);
      try {
        const response = await fetch("/api/business-location", {
          cache: "no-store", credentials: "include", signal,
        });
        const parsed = parseLocation(await response.json().catch(() => null));
        if (!stillCurrent()) return;
        if (!response.ok || !parsed || !stillCurrent(parsed.accountId)) throw new Error(t("locationLoadError"));
        accountRef.current = parsed.accountId;
        persistedRef.current = parsed.location;
        // A refresh must never replace a manual edit made while it was loading.
        if (!dirtyRef.current) publishDraft(parsed.location);
        loadingRef.current = false;
        setLoading(false);
        if ((parsed.location.postalCode && parsed.location.city) || autofillAccountsRef.current.has(parsed.accountId)) return;

        autofillAccountsRef.current.add(parsed.accountId);
        setAutofilling(true);
        const persistedRevision = persistedRevisionRef.current;
        const fillResponse = await fetch("/api/business-location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include", cache: "no-store", signal,
          body: JSON.stringify({ action: "autofill", accountId: parsed.accountId }),
        });
        const filled = parseLocation(await fillResponse.json().catch(() => null));
        if (!stillCurrent(filled?.accountId) || !fillResponse.ok || !filled || filled.accountId !== parsed.accountId
          || persistedRevisionRef.current !== persistedRevision) return;
        const preserveDraft = dirtyRef.current;
        const locationChanged = locationSignature(filled.location) !== locationSignature(persistedRef.current);
        persistedRef.current = filled.location;
        publishDraft(preserveDraft ? draftRef.current : filled.location);
        setSource(filled.source);
        if (locationChanged) {
          await Promise.all([
            refreshPublicProfileDependents("profile"),
            invalidateBoosterGenerationContextClient("professional"),
          ]);
        }
      } catch (loadError) {
        if (stillCurrent() && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
          // Channel discovery is optional; an existing location stays editable.
          if (!accountRef.current) setError(t("locationLoadError"));
        }
      } finally {
        if (stillCurrent()) {
          loadingRef.current = false;
          setLoading(false);
          setAutofilling(false);
        }
      }
    };
    const onAccountChange = () => { void load(true); };
    const onProfileSaved = () => { void load(); };
    void load(true);
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, onAccountChange);
    window.addEventListener(PUBLIC_PROFILE_DATA_SAVED_EVENT, onProfileSaved);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, onAccountChange);
      window.removeEventListener(PUBLIC_PROFILE_DATA_SAVED_EVENT, onProfileSaved);
    };
  }, [loadAttempt, publishDraft, t]);

  const save = useCallback(async () => {
    const accountId = accountRef.current;
    const browserScope = browserScopeRef.current;
    if (!accountId || loadingRef.current || savingRef.current || (getActiveBrowserUserId() || "") !== browserScope) return false;
    if (!dirtyRef.current) return true;
    const saveVersion = ++saveVersionRef.current;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const submitted = { postalCode: draftRef.current.postalCode.trim(), city: draftRef.current.city.trim() };
    try {
      const response = await fetch("/api/business-location", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include", cache: "no-store",
        body: JSON.stringify({ accountId, ...submitted }),
      });
      const parsed = parseLocation(await response.json().catch(() => null));
      if (saveVersionRef.current !== saveVersion || accountRef.current !== accountId
        || (getActiveBrowserUserId() || "") !== browserScope) return false;
      if (!response.ok || !parsed || parsed.accountId !== accountId) throw new Error(t("locationSaveError"));
      persistedRevisionRef.current += 1;
      persistedRef.current = parsed.location;
      publishDraft(parsed.location);
      setSource("");
      await Promise.all([
        refreshPublicProfileDependents("profile"),
        invalidateBoosterGenerationContextClient("professional"),
      ]);
      return saveVersionRef.current === saveVersion && accountRef.current === accountId
        && (getActiveBrowserUserId() || "") === browserScope;
    } catch {
      if (saveVersionRef.current === saveVersion && accountRef.current === accountId
        && (getActiveBrowserUserId() || "") === browserScope) setError(t("locationSaveError"));
      return false;
    } finally {
      if (saveVersionRef.current === saveVersion) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }, [publishDraft, t]);

  useImperativeHandle(ref, () => ({
    isReady: () => !loadingRef.current && !savingRef.current && Boolean(accountRef.current),
    canAutoSave: () => Boolean(draftRef.current.postalCode.trim() && draftRef.current.city.trim()),
    save,
    cancelChanges: () => { publishDraft(persistedRef.current); setError(""); },
  }), [publishDraft, save]);

  const fieldsDisabled = disabled || loading || saving || !accountRef.current;
  return (
    <section data-business-location className={styles.card} aria-busy={loading || saving}>
      <div className={styles.heading}>
        <div>
          <h3>{t("locationTitle")}</h3>
          <p>{t("locationHint")}</p>
        </div>
        {autofilling ? <span role="status" className={styles.hint}>{t("locationAutofilling")}</span> : null}
      </div>
      <div className={styles.grid}>
        <div className={styles.address}>
          <label htmlFor={`${inputId}-postal`}>
            <span>{t("locationPostalCode")}</span>
            <input id={`${inputId}-postal`} autoComplete="postal-code" maxLength={30} value={draft.postalCode}
              disabled={fieldsDisabled} placeholder="62000"
              onChange={(event) => { setError(""); publishDraft({ ...draftRef.current, postalCode: event.target.value }); }} />
          </label>
          <label htmlFor={`${inputId}-city`}>
            <span>{t("locationCity")}</span>
            <input id={`${inputId}-city`} autoComplete="address-level2" maxLength={120} value={draft.city}
              disabled={fieldsDisabled} placeholder={t("mainContentAreaPlaceholder")}
              onChange={(event) => { setError(""); publishDraft({ ...draftRef.current, city: event.target.value }); }} />
          </label>
          {source ? <span className={styles.hint}>{t("locationSource", { source: SOURCE_LABELS[source] || source })}</span> : null}
        </div>
        <div className={styles.target}>
          <label className={styles.checkbox} htmlFor={`${inputId}-use-location`}>
            <input id={`${inputId}-use-location`} type="checkbox" checked={value.useHeadquarters} disabled={disabled}
              onChange={(event) => onChange({ ...value, useHeadquarters: event.target.checked })} />
            <span>{t("useLocationForContent")}</span>
          </label>
          {!value.useHeadquarters ? (
            <label htmlFor={`${inputId}-primary-area`}>
              <span>{t("mainContentAreaLabel")}</span>
              <input id={`${inputId}-primary-area`} value={value.primaryArea} disabled={disabled} maxLength={120}
                placeholder={t("mainContentAreaPlaceholder")}
                onChange={(event) => onChange({ ...value, primaryArea: event.target.value })} />
            </label>
          ) : null}
          <p className={styles.hint}>{t("mainContentAreaHint")}</p>
        </div>
      </div>
      {error ? <div role="alert" className={styles.error}>{error}{!accountRef.current ? (
        <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("retry")}</button>
      ) : null}</div> : null}
    </section>
  );
});

export default BusinessLocationFields;
