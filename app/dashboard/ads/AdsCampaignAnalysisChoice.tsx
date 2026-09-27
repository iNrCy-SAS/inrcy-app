"use client";

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
      <legend>Mode d’analyse</legend>
      <p id={descriptionId}>
        Votre iNrADN guide les deux parcours. Laissez iNrCy choisir le cap ou indiquez un objectif précis.
      </p>

      <div role="radiogroup" aria-label="Mode d&apos;analyse iNrCy">
        <label data-selected={value === "free" || undefined}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="free"
            checked={value === "free"}
            onChange={handleModeChange}
          />
          <span>
            <strong>Analyse libre iNrADN</strong>
            <small>
              iNrCy étudie votre activité, vos clients et votre historique pour choisir la stratégie la plus pertinente.
            </small>
            <b>iNrCy choisit le cap</b>
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
            <strong>Analyse par objectif précis</strong>
            <small>
              Vous indiquez le résultat attendu&nbsp;; iNrCy adapte le ciblage et les messages.
            </small>
            <b>Je fixe le cap</b>
          </span>
        </label>
      </div>

      {value === "guided" ? (
        <div data-analysis-objective>
          <label htmlFor={objectiveId}>Résultat recherché</label>
          <textarea
            id={objectiveId}
            value={objective}
            onChange={(event) => onObjectiveChange(event.currentTarget.value)}
            placeholder="Ex. Plus de demandes de devis à Lyon."
            aria-describedby={objectiveHintId}
            required
            rows={3}
          />
          <small id={objectiveHintId}>Décrivez votre objectif avec vos mots. iNrCy le confrontera à votre iNrADN.</small>
        </div>
      ) : null}
    </fieldset>
  );
}
