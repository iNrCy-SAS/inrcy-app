import { redirect } from "next/navigation";

export default function ProfilPage() {
  redirect("/dashboard/adn-entreprise?tab=profile");
}
