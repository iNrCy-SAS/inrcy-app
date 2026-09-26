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
      <legend>Comment souhaitez-vous guider iNrCy&nbsp;?</legend>
      <p id={descriptionId}>
        Votre iNrADN est toujours pris en compte. Choisissez si iNrCy doit explorer librement la meilleure
        opportunité ou construire sa recommandation autour d&apos;un résultat précis.
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
            <strong>Analyse libre de mon iNrADN</strong>
            <small>
              iNrCy croise votre activité, vos clients, votre historique et vos ressources pour choisir la
              stratégie la plus pertinente.
            </small>
            <b>iNrCy choisit le meilleur cap</b>
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
            <strong>Analyse guidée par un objectif précis</strong>
            <small>
              Vous donnez le résultat attendu&nbsp;; iNrCy bâtit ensuite la stratégie, les messages et le ciblage
              autour de cette priorité.
            </small>
            <b>Je donne le cap à iNrCy</b>
          </span>
        </label>
      </div>

      {value === "guided" ? (
        <div data-analysis-objective>
          <label htmlFor={objectiveId}>Quel résultat voulez-vous obtenir&nbsp;?</label>
          <textarea
            id={objectiveId}
            value={objective}
            onChange={(event) => onObjectiveChange(event.currentTarget.value)}
            placeholder="Ex. Obtenir plus de demandes de devis pour mon service d’installation à Lyon."
            aria-describedby={objectiveHintId}
            required
            rows={3}
          />
          <small id={objectiveHintId}>
            Décrivez le résultat attendu avec vos mots. iNrCy le confrontera à votre iNrADN avant de préparer la
            campagne.
          </small>
        </div>
      ) : null}
    </fieldset>
  );
}
