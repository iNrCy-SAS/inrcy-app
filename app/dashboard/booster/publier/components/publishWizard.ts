import type { BoosterCreationMode } from "@/lib/boosterCreationMode";

// Presentation only. The generation, review and publication actions stay in PublishModal.
export type PublishWizardStep =
  | "mode"
  | "channels"
  | "intention"
  | "content"
  | "media"
  | "control"
  | "validation"
  | "publication"
  | "results";

const AUTOMATIC_STEPS: readonly PublishWizardStep[] = [
  "channels", "intention", "content", "media", "control", "publication",
];
const MANUAL_STEPS = AUTOMATIC_STEPS.filter((step) => step !== "intention");

export function getPublishWizardSteps(mode: BoosterCreationMode | null) {
  return mode === "manual" ? MANUAL_STEPS : AUTOMATIC_STEPS;
}

// Review and results keep their existing callbacks, within the same visible step.
export function getVisiblePublishWizardStep(step: PublishWizardStep): PublishWizardStep {
  if (step === "mode") return "channels";
  if (step === "validation") return "control";
  if (step === "results") return "publication";
  return step;
}

export function canOpenPublishWizardStep(
  step: PublishWizardStep,
  state: { mode: BoosterCreationMode | null; channelCount: number; contentReady: boolean; busy: boolean },
) {
  if (state.busy) return false;
  if (step === "mode") return true;
  if (step === "channels") return true;
  if (!state.mode || state.channelCount === 0) return false;
  if (step === "intention") return state.mode === "ai";
  if (step === "content" || step === "media" || step === "control") return state.contentReady;
  // These steps are entered by the existing review / publication callbacks only.
  return false;
}

export function getRestoredPublishWizardStep(
  mode: BoosterCreationMode | null,
  hasContent: boolean,
): PublishWizardStep {
  if (!mode) return "mode";
  return hasContent || mode === "manual" ? "content" : "intention";
}
