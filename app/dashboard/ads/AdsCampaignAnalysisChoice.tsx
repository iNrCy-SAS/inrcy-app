"use client";

import { useTranslations } from "next-intl";


import { useId, type ChangeEvent } from "react";

export type AdsCampaignAnalysisMode = "free" | "guided";

export type AdsCampaignAnalysisChoiceProps = {
  /** Whether iNrCy may choose the campaign direction, or should follow a professional's stated priority. */
  value: AdsCampaignAnalysisMode;
  onChange: (mode: AdsCampaignAnalysisMode) => void;
  /** The professional's own words when the guided path is selected. */
  objective: string;
  onObjectiveChange: (objective: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/**
 * Choice displayed immediately before an iNrCy Ads analysis starts.
 *
 * It deliberately owns no presentation styles: the campaign studio can place
 * it in its existing visual system while the native radio controls preserve
 * mouse, keyboard and screen-reader behaviour out of the box.
 */
export default function AdsCampaignAnalysisChoice({
  value,
  onChange,
  objective,
  onObjectiveChange,
  disabled = false,
  className,
  id: providedId,
}: AdsCampaignAnalysisChoiceProps) {
  const i18nT = useTranslations("booster");
  const generatedId = useId();
  const id = providedId ?? `ads-analysis-choice-${generatedId}`;
  const descriptionId = `${id}-description`;
  const objectiveId = `${id}-objective`;
  const objectiveHintId = `${objectiveId}-hint`;

  const handleModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.value as AdsCampaignAnalysisMode);
  };

  return (
    <fieldset
      className={className}
      data-component="ads-campaign-analysis-choice"
      data-mode={value}
      aria-describedby={descriptionId}
      disabled={disabled}
    >
      <legend>{i18nT("mode_d_analyse_40afc8bd")}</legend>
      <p id={descriptionId}>
        {i18nT("votre_inradn_guide_les_deux_parcours_12289081")}{" "}</p>

      <div role="radiogroup" aria-label={i18nT("mode_d_apos_analyse_inrcy_336a6b99")}>
        <label data-selected={value === "free" || undefined}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="free"
            checked={value === "free"}
            onChange={handleModeChange}
          />
          <span>
            <strong>{i18nT("analyse_libre_inradn_5b755ba2")}</strong>
            <small>
              {i18nT("inrcy_etudie_votre_activite_vos_clients_49f021cf")}{" "}</small>
            <b>{i18nT("inrcy_choisit_le_cap_6618168b")}</b>
          </span>
        </label>

        <label data-selected={value === "guided" || undefined}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="guided"
            checked={value === "guided"}
            onChange={handleModeChange}
          />
          <span>
            <strong>{i18nT("analyse_par_objectif_precis_e15b62fb")}</strong>
            <small>
              {i18nT("vous_indiquez_le_resultat_attendu_nbsp_6b96558f")}{" "}</small>
            <b>{i18nT("je_fixe_le_cap_c8104bf8")}</b>
          </span>
        </label>
      </div>

      {value === "guided" ? (
        <div data-analysis-objective>
          <label htmlFor={objectiveId}>{i18nT("resultat_recherche_f2008ae5")}</label>
          <textarea
            id={objectiveId}
            value={objective}
            onChange={(event) => onObjectiveChange(event.currentTarget.value)}
            placeholder={i18nT("ex_plus_de_demandes_de_devis_ce094567")}
            aria-describedby={objectiveHintId}
            required
            rows={3}
          />
          <small id={objectiveHintId}>{i18nT("decrivez_votre_objectif_avec_vos_mots_f5d66ebd")}</small>
        </div>
      ) : null}
    </fieldset>
  );
}
