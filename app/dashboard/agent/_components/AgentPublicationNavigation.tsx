import { useTranslations } from "next-intl";
import type { PublicationValidationFilters, PublicationValidationState } from "../_lib/agent.publication-validation";
import css from "./AgentPublicationNavigation.module.css";

type Props = {
  current: number;
  total: number;
  canNavigate: boolean;
  onMove: (offset: number) => void;
  counts: Record<PublicationValidationState, number>;
  filters: PublicationValidationFilters;
  disabled: boolean;
  onFilterChange: (state: PublicationValidationState, checked: boolean) => void;
};
const states = ["validated", "pending", "refused"] as const;

export default function AgentPublicationNavigation({ current, total, canNavigate, onMove, counts, filters, disabled, onFilterChange }: Props) {
  const t = useTranslations("agent");
  return <div className={css.bar}>
    <nav className={css.navigation} aria-label={t("publication_navigation")}>
      <button type="button" onClick={() => onMove(-1)} disabled={!canNavigate} aria-label={t("previous_publication")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
      <strong aria-live="polite">{t("publication_counter", { current, total })}</strong>
      <button type="button" onClick={() => onMove(1)} disabled={!canNavigate} aria-label={t("next_publication")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
    </nav>
    <fieldset className={css.filters} disabled={disabled}>
      <legend className={css.legend}>{t("publication_filter_label")}</legend>
      {states.map(state => <label key={state} data-state={state} data-active={filters[state]}>
        <span className={css.dot} aria-hidden="true" />
        <span>{t(state === "validated" ? "action_status_validated" : state === "pending" ? "publication_validation_pending" : "action_status_refused")}</span>
        <span className={css.count}>({counts[state]})</span>
        <input type="checkbox" checked={filters[state]} onChange={event => onFilterChange(state, event.currentTarget.checked)} />
      </label>)}
    </fieldset>
  </div>;
}
