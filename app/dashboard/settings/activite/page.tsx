import { redirect } from "next/navigation";

export default function ActivitePage() {
  redirect("/dashboard/adn-entreprise?tab=activity");
}
