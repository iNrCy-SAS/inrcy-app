import { useTranslations } from "next-intl";
import type { PublicationReviewState, PublicationValidationFilters } from "../_lib/agent.publication-validation";
import css from "./AgentPublicationNavigation.module.css";

type Props = {
  current: number;
  total: number;
  canNavigate: boolean;
  onMove: (offset: number) => void;
  counts: Record<PublicationReviewState, number>;
  filters: PublicationValidationFilters;
  disabled: boolean;
  onFilterFocus: (state: PublicationReviewState) => void;
  onFilterChange: (state: PublicationReviewState, checked: boolean) => void;
};
export default function AgentPublicationNavigation({ current, total, canNavigate, onMove, counts, filters, disabled, onFilterFocus, onFilterChange }: Props) {
  const t = useTranslations("agent");
  const statuses = [
    { state: "validated", label: t("action_status_validated") },
    { state: "pending", label: t("publication_channel_review_pending") },
    { state: "creating", label: t("publication_status_creating") },
    { state: "refused", label: t("action_status_refused") },
  ] as const;
  const singleStatus = statuses.filter(({ state }) => filters[state]).length === 1;
  return <div className={css.bar}>
    <nav className={css.navigation} aria-label={t("publication_navigation")}>
      <button type="button" onClick={() => onMove(-1)} disabled={!canNavigate} aria-label={t("previous_publication")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
      <strong aria-live="polite">{t("publication_counter", { current, total })}</strong>
      <button type="button" onClick={() => onMove(1)} disabled={!canNavigate} aria-label={t("next_publication")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
    </nav>
    <fieldset className={css.filters} disabled={disabled}>
      <legend className={css.legend}>{t("publication_filter_label")}</legend>
      {statuses.map(({ state, label }) => {
        const focused = singleStatus && filters[state];
        return <div className={css.filter} key={state} data-state={state} data-active={filters[state]}>
          <button type="button" aria-pressed={focused} onClick={() => onFilterFocus(state)}
            title={focused ? t("publication_filter_show_all") : t("publication_filter_show_only", { status: label })}>
            <span className={css.dot} aria-hidden="true" />
            <span>{label}</span>
            <span className={css.count}>({counts[state]})</span>
          </button>
          <label className={css.checkboxTarget}>
            <input type="checkbox" checked={filters[state]} aria-label={`${label} (${counts[state]})`}
              onChange={event => onFilterChange(state, event.currentTarget.checked)} />
          </label>
        </div>;
      })}
    </fieldset>
  </div>;
}
