import { redirect } from "next/navigation";

import { createSupabaseServer } from "@/lib/supabaseServer";
import { getVisioTeamActor } from "@/lib/visioTeamAccess";

import TeamAgendaClient from "./TeamAgendaClient";
import styles from "./teamAgenda.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TeamAgendaPage() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?next=%2Fequipe%2Fagenda");

  const actor = await getVisioTeamActor();
  if (!actor) {
    return (
      <main className={styles.deniedPage}>
        <section className={styles.deniedCard}>
          <span>🔒</span>
          <h1>Accès équipe requis</h1>
          <p>Cette interface est réservée à Jimmy, Océane et Apolline.</p>
          <a href="/dashboard">Retour au tableau de bord</a>
        </section>
      </main>
    );
  }

  return <TeamAgendaClient initialViewer={actor} />;
}
