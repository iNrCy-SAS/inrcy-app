import { redirect } from "next/navigation";

export default function ActivitePage() {
  redirect("/dashboard/mon-profil?section=activity");
}
