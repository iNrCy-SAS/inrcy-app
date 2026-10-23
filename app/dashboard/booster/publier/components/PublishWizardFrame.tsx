import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { getVisiblePublishWizardStep, type PublishWizardStep } from "./publishWizard";
import css from "./publishWizard.module.css";

type Props = {
  step: PublishWizardStep;
  steps: readonly PublishWizardStep[];
  canOpenStep: (step: PublishWizardStep) => boolean;
  onOpenStep: (step: PublishWizardStep) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  footer?: ReactNode;
  children: ReactNode;
};

export default function PublishWizardFrame({
  step, steps, canOpenStep, onOpenStep, onPrevious, onNext,
  nextDisabled, footer, children,
}: Props) {
  const t = useTranslations("booster");
  const visibleStep = getVisiblePublishWizardStep(step);
  const stageIndex = steps.indexOf(visibleStep);
  const bodyRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    bodyRef.current?.focus({ preventScroll: true });
    const navigation = navigationRef.current;
    const activeStep = navigation?.querySelector<HTMLElement>('[aria-current="step"]');
    if (navigation && activeStep && navigation.scrollWidth > navigation.clientWidth) {
      navigation.scrollTo({
        left: navigation.scrollLeft + activeStep.getBoundingClientRect().left - navigation.getBoundingClientRect().left - (navigation.clientWidth - activeStep.offsetWidth) / 2,
      });
    }
  }, [visibleStep]);

  return (
    <div className={css.wizard} data-publish-wizard data-current-step={step}>
      <nav ref={navigationRef} className={css.progress} aria-label={t("wizard_progress")}>
        <span className={css.progressLabel}>{t("wizard_steps")}</span>
        <ol className={css.steps}>
          {steps.map((item, index) => (
            <li key={item} data-complete={index < stageIndex}>
              <button
                type="button"
                className={css.step}
                aria-current={item === visibleStep ? "step" : undefined}
                data-complete={index < stageIndex}
                disabled={item !== visibleStep && !canOpenStep(item)}
                onClick={() => { if (item !== visibleStep) onOpenStep(item); }}
              >
                <span className={css.stepNumber} aria-hidden="true">{index < stageIndex ? "✓" : index + 1}</span>
                <span>{t(`wizard_step_${item}`)}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className={css.workspace}>
        <p className={css.instruction}>{t(`wizard_hint_${visibleStep}`)}</p>
        <div ref={bodyRef} className={css.body} data-publish-scroll tabIndex={-1} aria-label={t(`wizard_step_${visibleStep}`)}>
          {children}
        </div>
      </div>
      {onPrevious || onNext || footer ? <footer className={css.footer}>
        <div>
          {onPrevious ? <button type="button" className={css.previous} onClick={onPrevious} aria-label={t("wizard_previous")}>
            <span aria-hidden="true">←</span> <span className={css.previousLabel}>{t("wizard_previous")}</span>
          </button> : null}
        </div>
        <div className={css.footerActions}>
          {footer}
          {onNext ? <button type="button" className={css.next} onClick={onNext} disabled={nextDisabled}>
            {t("wizard_continue")} <span aria-hidden="true">→</span>
          </button> : null}
        </div>
      </footer> : null}
    </div>
  );
}

export function PublishWizardScreen({
  active, step, children,
}: { active: boolean; step: PublishWizardStep; children: ReactNode }) {
  // Keep editors mounted: channel drafts, voice input and media references must
  // survive navigation. A hidden screen has no focusable or accessible controls.
  return <section hidden={!active} data-wizard-screen={step} className={css.screen}>{children}</section>;
}
