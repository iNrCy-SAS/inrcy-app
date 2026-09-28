"use client";

import MailboxClient from "./MailboxClient";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";

export default function MailboxPageClient({ adsEnabled }: { adsEnabled: boolean }) {
  const edition = useDashboardEdition();
  return <MailboxClient standardMode={edition === "standard"} founderMode={edition === "founder"} adsEnabled={adsEnabled} />;
}
