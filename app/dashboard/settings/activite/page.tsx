import { redirect } from "next/navigation";

export default function ActivitePage() {
  redirect("/dashboard?panel=profil&profileSection=activity&panelSource=settings");
}
