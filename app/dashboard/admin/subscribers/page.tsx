import { redirect } from "next/navigation";
import { getMyRole } from "@/lib/roles";
import AdminSubscribersClient from "./AdminSubscribersClient";

export default async function AdminSubscribersPage() {
  const { isAdmin } = await getMyRole();
  if (!isAdmin) redirect("/dashboard");

  return <AdminSubscribersClient />;
}
