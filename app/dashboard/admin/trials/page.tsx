import { redirect } from "next/navigation";
import { getMyRole } from "@/lib/roles";
import AdminTrialsClient from "./AdminTrialsClient";

export default async function AdminTrialsPage() {
  const { isAdmin } = await getMyRole();
  if (!isAdmin) redirect("/dashboard");
  return <AdminTrialsClient />;
}
