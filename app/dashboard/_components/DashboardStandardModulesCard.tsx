"use client";

import DashboardModulesCard from "./DashboardModulesCard";

type Props = {
  goToModule: (path: string) => void;
  onOpenPremium: () => void;
  onOpenStats?: () => void;
  onOpenBoosterPublish?: () => void;
  onOpenBoosterStats?: () => void;
  adsPilotEnabled?: boolean;
  inrAgentEnabled?: boolean;
};

// One visual layout for both editions. Standard keeps its existing actions
// and opens the subscription panel for Premium-only tools and settings.
export default function DashboardStandardModulesCard({ onOpenPremium, ...props }: Props) {
  return <DashboardModulesCard {...props} standardMode openPanel={onOpenPremium} />;
}
