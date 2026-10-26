"use client";

import MailboxClient from "./MailboxClient";
import { isStandardDashboardEdition } from "@/lib/dashboardEdition";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";

export default function MailboxPageClient({ adsEnabled }: { adsEnabled: boolean }) {
  const edition = useDashboardEdition();
  return <MailboxClient standardMode={isStandardDashboardEdition(edition)} founderMode={edition === "founder"} adsEnabled={adsEnabled} />;
}
