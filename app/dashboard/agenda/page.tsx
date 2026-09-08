import AgendaClient from "./AgendaClient";
import { getVisioTeamActor } from "@/lib/visioTeamAccess";
import { getMyRole } from "@/lib/roles";

export default async function AgendaPage() {
  const [teamActor, role] = await Promise.all([getVisioTeamActor(), getMyRole()]);
  return (
    <AgendaClient
      canManageTeamAppointments={Boolean(teamActor)}
      canOpenGoogleAgenda={role.isAdmin}
    />
  );
}
