"use client";

import MailboxClient from "./MailboxClient";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";

export default function MailboxPage() {
  const edition = useDashboardEdition();
  return <MailboxClient standardMode={edition === "standard"} />;
}


