"use client";

import { useTranslations } from "next-intl";


import { createAdsApiRequestError } from "./adsClientHttp";
import { useAdsErrorMessage } from "./useAdsErrorMessage";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LINKEDIN_AUDIENCE_FACET_LABELS, linkedInAudienceDisplayName, uniqueLinkedInAudienceMatch, addLinkedInAudienceTarget, type LinkedInAudienceFacet, type LinkedInAudienceSuggestion } from "@/lib/adsLinkedInAudienceSuggestions";
import type { LinkedInDeliverySettings } from "@/lib/adsLinkedInCampaignSettings";
import styles from "./linkedin-campaign.module.css";

type Target = LinkedInDeliverySettings["professionalTargeting"]["include"][number];
type Proposal = { key: string; facet: LinkedInAudienceFacet; term: string; options: Target[]; selectedUrn: string; error: string };
const LIST_FACETS = new Set<LinkedInAudienceFacet>(["seniorities", "companySizes", "functions"]);

export default function LinkedInAdsAudience({ accountId, language, country, targeting, suggestions, active, onChange, onPendingChange }: {
  accountId: string; language: string; country: string; targeting: LinkedInDeliverySettings["professionalTargeting"];
  suggestions: LinkedInAudienceSuggestion[]; active: boolean;
  onChange: (targeting: LinkedInDeliverySettings["professionalTargeting"]) => void;
  onPendingChange: (count: number) => void;
}) {
  const i18nT = useTranslations("booster");
  const errorMessage = useAdsErrorMessage();
  const id = useId();
  const [facet, setFacet] = useState<LinkedInAudienceFacet>("seniorities");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"include" | "exclude">("include");
  const [options, setOptions] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const request = useRef(0);
  const suggestionRequest = useRef(0);
  const completedSuggestions = useRef("");
  const latest = useRef({ targeting, onChange, onPendingChange });
  latest.current = { targeting, onChange, onPendingChange };

  const lookup = useCallback(async (targetFacet: LinkedInAudienceFacet, term: string, signal?: AbortSignal): Promise<Target[]> => {
    const found = new Map<string, Target>();
    let start = 0;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ account: accountId, facet: targetFacet, language, country, start: String(start), count: "100" });
      if (term.trim()) params.set("query", term.trim());
      const response = await fetch(`/api/ads/linkedin/targeting?${params}`, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw createAdsApiRequestError(data, response.status);
      for (const target of Array.isArray(data.targets) ? data.targets : []) {
        if (target.facet === targetFacet && typeof target.urn === "string" && typeof target.name === "string") found.set(target.urn, target);
      }
      if (!LIST_FACETS.has(targetFacet) || !data.paging?.hasMore) return [...found.values()];
      const count = Number(data.paging.count);
      if (!Number.isInteger(count) || count <= 0) throw new Error("LinkedIn n’a pas fourni une pagination valide. Relancez la recherche.");
      start += count;
    }
    throw new Error("Trop de choix LinkedIn. Précisez votre recherche.");
  }, [accountId, language, country]);

  useEffect(() => {
    request.current++;
    setOptions([]); setProposals([]); setBusy(false); setError("");
    completedSuggestions.current = "";
  }, [accountId, language, country]);

  const suggestionKey = JSON.stringify([accountId, language, country, suggestions]);
  useEffect(() => {
    if (!suggestions.length) { setProposals([]); completedSuggestions.current = ""; latest.current.onPendingChange(0); return; }
    if (!active || !accountId || completedSuggestions.current === suggestionKey) return;
    const revision = ++suggestionRequest.current;
    const controller = new AbortController();
    const inputs = suggestions.flatMap((item) => item.terms.map((term) => ({ facet: item.facet, term })));
    setProposals([]);
    latest.current.onPendingChange(inputs.length);
    const lookups = new Map<string, Promise<Target[]>>();
    const cachedLookup = (targetFacet: LinkedInAudienceFacet, term: string) => {
      const key = targetFacet + ":" + term;
      if (!lookups.has(key)) lookups.set(key, lookup(targetFacet, term, controller.signal));
      return lookups.get(key)!;
    };
    void Promise.all(inputs.map(async (input): Promise<Proposal> => {
      try {
        const targets = await cachedLookup(input.facet, LIST_FACETS.has(input.facet) && input.facet !== "industries" ? "" : input.term);
        const match = uniqueLinkedInAudienceMatch(input.term, targets);
        return { ...input, key: `${input.facet}:${input.term}`, options: targets, selectedUrn: match?.urn || "", error: "" };
      } catch (failure) { return { ...input, key: `${input.facet}:${input.term}`, options: [], selectedUrn: "", error: errorMessage(failure, "shell.ads_error_d9866b94a3") }; }
    })).then((rows) => {
      if (controller.signal.aborted || revision !== suggestionRequest.current) return;
      completedSuggestions.current = suggestionKey;
      let current = latest.current.targeting;
      const checked = rows.map((row) => {
        const match = row.options.find((option) => option.urn === row.selectedUrn);
        if (!match) return row;
        const result = addLinkedInAudienceTarget(current, match, "include");
        if (result.error) return { ...row, selectedUrn: "", error: errorMessage(result, "shell.ads_error_d9866b94a3") };
        current = result.targeting;
        return row;
      });
      setProposals(checked);
      if (current !== latest.current.targeting) latest.current.onChange(current);
      latest.current.onPendingChange(checked.filter((row) => !row.selectedUrn).length);
    });
    return () => controller.abort();
  }, [active, accountId, suggestionKey, suggestions, lookup, errorMessage]);

  async function search() {
    if (!accountId || busy || (!LIST_FACETS.has(facet) && query.trim().length < 2)) return;
    const revision = ++request.current;
    setBusy(true); setError("");
    try { const found = await lookup(facet, query); if (revision === request.current) setOptions(found); }
    catch (failure) { if (revision === request.current) { setOptions([]); setError(errorMessage(failure, "shell.ads_error_d9866b94a3")); } }
    finally { if (revision === request.current) setBusy(false); }
  }

  function add(target: Target, targetMode = mode) {
    const result = addLinkedInAudienceTarget(latest.current.targeting, target, targetMode);
    if (result.error) { setError(errorMessage(result, "shell.ads_error_d9866b94a3")); return false; }
    onChange(result.targeting); setError("");
    return true;
  }

  function chooseProposal(row: Proposal, urn: string) {
    const target = row.options.find((option) => option.urn === urn);
    if (!target) return;
    if (!add(target, "include")) return;
    const next = proposals.map((item) => item.key === row.key ? { ...item, selectedUrn: urn } : item);
    setProposals(next); onPendingChange(next.filter((item) => !item.selectedUrn).length);
  }

  return <div className={styles.panel} data-linkedin-professional-targeting="true">
    <div className={styles.heading}><div><strong>{i18nT("audience_professionnelle_88032659")}</strong><p>{i18nT("les_criteres_ci_dessous_sont_de_d7daa822")}</p></div><span className={styles.badge}>{i18nT("value_criteres_c81f501d", { value0: targeting.include.length })}</span></div>
    {proposals.some((row) => !row.selectedUrn) && <div className={styles.proposals}><strong>{i18nT("preciser_les_propositions_de_l_ia_18a11d35")}</strong>{proposals.filter((row) => !row.selectedUrn).map((row) => <div className={styles.locationRow} key={row.key}><label htmlFor={`${id}-${row.key}`}>{linkedInAudienceDisplayName({ facet: row.facet, name: row.term })}<small>{LINKEDIN_AUDIENCE_FACET_LABELS[row.facet]}</small></label><select id={`${id}-${row.key}`} value="" onChange={(event) => chooseProposal(row, event.target.value)}><option value="">{i18nT("choisir_une_correspondance_283f3dc6")}</option>{row.options.map((option) => <option key={option.urn} value={option.urn}>{linkedInAudienceDisplayName(option)}</option>)}</select><button type="button" aria-label={i18nT("ignorer_la_proposition_value_1267579a", { value0: linkedInAudienceDisplayName({ facet: row.facet, name: row.term }) })} onClick={() => { const next = proposals.filter((item) => item.key !== row.key); setProposals(next); onPendingChange(next.filter((item) => !item.selectedUrn).length); }}>{i18nT("ignorer_b0d64e49")}</button>{row.error && <small className={styles.error}>{row.error}</small>}</div>)}</div>}
    <div className={styles.targetingGrid}><label>{i18nT("categorie_6b38300a")}<select value={facet} onChange={(event) => { setFacet(event.target.value as LinkedInAudienceFacet); setOptions([]); setQuery(""); setError(""); request.current++; setBusy(false); }}>{Object.entries(LINKEDIN_AUDIENCE_FACET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{i18nT("utilisation_e894c530")}<select value={mode} onChange={(event) => setMode(event.target.value as "include" | "exclude")}><option value="include">{i18nT("inclure_ces_profils_2d14fbaf")}</option><option value="exclude">{i18nT("exclure_ces_profils_f3db7e57")}</option></select></label></div>
    <div className={styles.searchRow}><label htmlFor={`${id}-query`} className={styles.srOnly}>{i18nT("rechercher_un_critere_professionnel_26d63c99")}</label><input id={`${id}-query`} value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder={LIST_FACETS.has(facet) ? i18nT("recherche_facultative_dans_les_choix_linkedin_75b3e14b") : i18nT("ex_directeur_commercial_fbaa091d")} /><button type="button" onClick={() => void search()} disabled={!accountId || busy || (!LIST_FACETS.has(facet) && query.trim().length < 2)}>{busy ? i18nT("recherche_af776274") : i18nT("afficher_les_choix_c8f42c85")}</button></div>
    {options.length > 0 && <label className={styles.field}>{i18nT("ajouter_un_critere_4ad28bc1")}<select value="" onChange={(event) => { const target = options.find((option) => option.urn === event.target.value); if (target) add(target); }}><option value="">{i18nT("selectionner_parmi_les_choix_linkedin_b7c4132f")}</option>{options.map((option) => <option key={option.urn} value={option.urn} disabled={targeting[mode].some((target) => target.urn === option.urn && target.facet === option.facet)}>{linkedInAudienceDisplayName(option)}</option>)}</select></label>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!targeting.include.length && <small>{i18nT("sans_critere_professionnel_tous_les_profils_ca5c47ef")}</small>}
    {(["include", "exclude"] as const).map((kind) => targeting[kind].length > 0 && <div className={styles.selected} key={kind}><strong>{kind === "include" ? i18nT("profils_inclus_2e9bab49") : i18nT("profils_exclus_6aad554f")}</strong>{Object.entries(LINKEDIN_AUDIENCE_FACET_LABELS).map(([key, label]) => { const values = targeting[kind].filter((target) => target.facet === key); return values.length ? <div key={key}><small>{label}</small><ul className={styles.chips}>{values.map((target) => <li key={`${target.facet}:${target.urn}`}><span>{linkedInAudienceDisplayName(target)}</span><button type="button" aria-label={i18nT("retirer_value_c04cdfcb", { value0: linkedInAudienceDisplayName(target) })} onClick={() => onChange({ ...targeting, [kind]: targeting[kind].filter((item) => item.urn !== target.urn || item.facet !== target.facet) })}>×</button></li>)}</ul></div> : null; })}</div>)}
  </div>;
}
