"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { useTranslations } from "next-intl";
import DashboardAgentPlanningModal from "../agent/_components/DashboardAgentPlanningModal";
import css from "./PublishScheduleModal.module.css";

type Props = { onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null> };

export default function SchedulePlanningPreview({ onClose, returnFocusRef }: Props) {
  const t = useTranslations("booster");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const returnTarget = returnFocusRef.current;
    container.current?.focus({ preventScroll: true });
    return () => { returnTarget?.focus({ preventScroll: true }); };
  }, [returnFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); onClose(); return;
    }
    if (event.key !== "Tab") return;
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    const first = elements[0], last = elements.at(-1);
    if (!first || !last) { event.preventDefault(); container.current?.focus(); }
    else if (document.activeElement === container.current || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div ref={container} className={css.planningOverlay} tabIndex={-1} onKeyDownCapture={handleKeyDown} data-schedule-planning-preview>
    <DashboardAgentPlanningModal open workspace="publications" inspectionOnly closeLabel={t("schedule_back_to_programming")} onClose={onClose} />
  </div>;
}
