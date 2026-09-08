"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./teamAgenda.module.css";

type TeamMember = { id: string; name: string };
type TeamAppointment = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  meetUrl: string;
  calendarUrl: string;
  currentMemberId: string;
  currentMemberName: string;
  sourceType: "booking" | "calendar";
};
type TeamViewer = { userId: string; email: string; name: string };

type AppointmentsPayload = {
  ok?: boolean;
  error?: string;
  appointments?: TeamAppointment[];
  members?: TeamMember[];
  viewer?: { email: string; name: string };
};

const PARIS_TIME_ZONE = "Europe/Paris";

function dayKey(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: PARIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string, allDay: boolean) {
  if (allDay) return "Toute la journée";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value)).replace(":", "h");
}

export default function TeamAgendaClient({
  initialViewer,
}: {
  initialViewer: TeamViewer;
}) {
  const [appointments, setAppointments] = useState<TeamAppointment[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assigningId, setAssigningId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadAppointments = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const endpoint = manual
        ? "/api/internal/visio-booking/appointments?refresh=1"
        : "/api/internal/visio-booking/appointments";
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({})) as AppointmentsPayload;
      if (!response.ok) throw new Error(payload.error || "Impossible de charger les rendez-vous.");
      setAppointments(Array.isArray(payload.appointments) ? payload.appointments : []);
      setMembers(Array.isArray(payload.members) ? payload.members : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les rendez-vous.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  const groupedAppointments = useMemo(() => {
    const groups = new Map<string, TeamAppointment[]>();
    for (const appointment of appointments) {
      const key = dayKey(appointment.start);
      groups.set(key, [...(groups.get(key) || []), appointment]);
    }
    return [...groups.entries()];
  }, [appointments]);

  const reassign = useCallback(async (
    appointment: TeamAppointment,
    target: TeamMember,
  ) => {
    if (appointment.currentMemberId === target.id || assigningId) return;
    const previousMemberId = appointment.currentMemberId;
    const previousMemberName = appointment.currentMemberName;
    setAssigningId(appointment.id);
    setError("");
    setSuccess("");
    setAppointments((current) => current.map((item) =>
      item.id === appointment.id
        ? {
            ...item,
            currentMemberId: target.id,
            currentMemberName: target.name,
          }
        : item,
    ));
    try {
      const response = await fetch("/api/internal/visio-booking/appointments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mirrorEventId: appointment.id,
          targetMemberId: target.id,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        appointment?: TeamAppointment;
      };
      if (!response.ok || !payload.appointment) {
        throw new Error(payload.error || "La réattribution a échoué.");
      }
      setAppointments((current) => current.map((item) =>
        item.id === appointment.id || item.id === payload.appointment?.id
          ? payload.appointment as TeamAppointment
          : item,
      ));
      setSuccess(
        `${appointment.title} est maintenant attribué uniquement à ${target.name}.`,
      );
    } catch (assignmentError) {
      setAppointments((current) => current.map((item) =>
        item.id === appointment.id
          ? {
              ...item,
              currentMemberId: previousMemberId,
              currentMemberName: previousMemberName,
            }
          : item,
      ));
      setError(assignmentError instanceof Error ? assignmentError.message : "La réattribution a échoué.");
    } finally {
      setAssigningId("");
    }
  }, [assigningId]);

  return (
    <main className={styles.page}>
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />
      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brandBlock}>
            <Image
              src="/logo-inrcy.png"
              alt="iNrCy"
              width={124}
              height={48}
              className={styles.logo}
              priority
            />
            <div>
              <p className={styles.eyebrow}>OUTIL INTERNE</p>
              <h1>Attribution des rendez-vous</h1>
              <p className={styles.subtitle}>
                Tous les rendez-vous positionnés, toutes catégories confondues :
                7 jours d’historique et 14 jours à venir.
              </p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.viewer}>
              <span>Connecté</span>
              <strong>{initialViewer.name}</strong>
            </div>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void loadAppointments(true)}
              disabled={refreshing || Boolean(assigningId)}
            >
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
            <Link href="/dashboard/agenda" className={styles.backLink}>iNrCalendar</Link>
          </div>
        </header>

        <div className={styles.reassurance}>
          <span className={styles.reassuranceIcon}>✓</span>
          <div>
            <strong>Identité publique conservée</strong>
            <p>
              Les réservations automatiques restent envoyées par Équipe iNrCy.
              Un seul responsable interne est conservé. Aucun e-mail de changement n’est envoyé.
            </p>
          </div>
        </div>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {success ? <div className={styles.success} role="status">{success}</div> : null}

        {loading ? (
          <div className={styles.stateCard}>Chargement des rendez-vous…</div>
        ) : groupedAppointments.length === 0 ? (
          <div className={styles.stateCard}>Aucun rendez-vous positionné sur cette période.</div>
        ) : (
          <div className={styles.days}>
            {groupedAppointments.map(([key, items]) => (
              <section className={styles.day} key={key}>
                <h2>{formatDay(items[0].start)}</h2>
                <div className={styles.appointments}>
                  {items.map((appointment) => (
                    <article className={styles.appointment} key={appointment.id}>
                      <div className={styles.timeBlock}>
                        <strong>{formatTime(appointment.start, appointment.allDay)}</strong>
                        {!appointment.allDay ? <span>→ {formatTime(appointment.end, false)}</span> : null}
                      </div>
                      <div className={styles.appointmentDetails}>
                        <div className={styles.titleRow}>
                          <h3>{appointment.title}</h3>
                          <span className={`${styles.kind} ${appointment.sourceType === "booking" ? styles.kindBooking : ""}`}>
                            {appointment.sourceType === "booking" ? "Réservation site" : "Agenda"}
                          </span>
                        </div>
                        <div className={styles.links}>
                          {appointment.meetUrl ? (
                            <a href={appointment.meetUrl} target="_blank" rel="noreferrer">Ouvrir Google Meet</a>
                          ) : null}
                          {appointment.calendarUrl ? (
                            <a href={appointment.calendarUrl} target="_blank" rel="noreferrer">Voir dans Google Agenda</a>
                          ) : null}
                        </div>
                      </div>
                      <div className={styles.assignment}>
                        <p>Responsable actuel : <strong>{appointment.currentMemberName}</strong></p>
                        <div className={styles.memberButtons} aria-label={`Attribuer ${appointment.title}`}>
                          {members.map((member) => {
                            const active = appointment.currentMemberId === member.id;
                            const pending = assigningId === appointment.id;
                            return (
                              <button
                                key={member.id}
                                type="button"
                                className={active ? styles.memberButtonActive : styles.memberButton}
                                disabled={active || Boolean(assigningId) || refreshing}
                                onClick={() => void reassign(appointment, member)}
                              >
                                {pending && active ? "Mise à jour…" : active ? `✓ ${member.name}` : member.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
