"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  VISIO_APPOINTMENT_STATUS_LABELS,
  visioAppointmentManualTransitions,
  type VisioAppointmentOrigin,
  type VisioAppointmentStatus,
} from "@/lib/visioAppointmentLifecycle";
import { shouldApplyVisioTeamAppointmentsResponse } from "@/lib/visioTeamAgendaRequestPolicy";

import styles from "./teamAgenda.module.css";

type TeamMember = { id: string; name: string };
type TeamAppointment = {
  id: string;
  identity: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  meetUrl: string;
  calendarUrl: string;
  currentMemberId: string;
  currentMemberName: string;
  sourceType: "booking" | "calendar";
  status: VisioAppointmentStatus;
  statusLabel: string;
  colorId: string;
  origin: VisioAppointmentOrigin;
  managedLifecycle: boolean;
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

function toParisDateTimeLocal(value: string) {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: PARIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function formatDuration(startValue: string, endValue: string) {
  const minutes = Math.round(
    (new Date(endValue).getTime() - new Date(startValue).getTime()) / 60_000,
  );
  if (!Number.isFinite(minutes) || minutes <= 0) return "durée actuelle";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder}` : `${hours} h`;
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
  const [reschedulingId, setReschedulingId] = useState("");
  const [resendingId, setResendingId] = useState("");
  const [statusUpdatingId, setStatusUpdatingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [newStartLocal, setNewStartLocal] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const resendDeliveryKeys = useRef(new Map<string, string>());
  const appointmentMutationInFlight = useRef(false);
  const appointmentMutationRevision = useRef(0);
  const appointmentLoadSequence = useRef(0);
  const lastAppliedAppointmentLoad = useRef(0);

  const beginAppointmentMutation = useCallback(() => {
    if (appointmentMutationInFlight.current) return false;
    appointmentMutationInFlight.current = true;
    // Any list request that started before this mutation is now stale. Its
    // response must never overwrite the authoritative mutation response.
    appointmentMutationRevision.current += 1;
    return true;
  }, []);

  const endAppointmentMutation = useCallback(() => {
    appointmentMutationInFlight.current = false;
  }, []);

  const loadAppointments = useCallback(async (manual = false, silent = false) => {
    // The 15-second refresh used to race a date/status update: an older GET
    // could finish after the PATCH and visually restore the former slot/color.
    if (appointmentMutationInFlight.current) return;
    const requestSequence = appointmentLoadSequence.current + 1;
    appointmentLoadSequence.current = requestSequence;
    const mutationRevision = appointmentMutationRevision.current;
    if (manual) setRefreshing(true);
    else if (!silent) setLoading(true);
    if (!silent) setError("");
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
      if (!shouldApplyVisioTeamAppointmentsResponse({
        startedMutationRevision: mutationRevision,
        currentMutationRevision: appointmentMutationRevision.current,
        requestSequence,
        lastAppliedRequestSequence: lastAppliedAppointmentLoad.current,
        mutationInFlight: appointmentMutationInFlight.current,
      })) {
        return;
      }
      lastAppliedAppointmentLoad.current = requestSequence;
      setAppointments(Array.isArray(payload.appointments) ? payload.appointments : []);
      setMembers(Array.isArray(payload.members) ? payload.members : []);
    } catch (loadError) {
      if (
        !silent &&
        mutationRevision === appointmentMutationRevision.current &&
        !appointmentMutationInFlight.current
      ) {
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger les rendez-vous.");
      }
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadAppointments(false, true);
      }
    }, 15_000);
    return () => window.clearInterval(interval);
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
    if (
      appointment.currentMemberId === target.id ||
      assigningId ||
      reschedulingId ||
      resendingId ||
      statusUpdatingId
    ) return;
    if (!beginAppointmentMutation()) return;
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
          appointmentIdentity: appointment.identity,
          appointmentStart: appointment.start,
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
      endAppointmentMutation();
    }
  }, [
    assigningId,
    beginAppointmentMutation,
    endAppointmentMutation,
    reschedulingId,
    resendingId,
    statusUpdatingId,
  ]);

  const beginReschedule = useCallback((appointment: TeamAppointment) => {
    if (
      appointment.allDay ||
      assigningId ||
      reschedulingId ||
      resendingId ||
      statusUpdatingId
    ) return;
    setEditingId(appointment.id);
    setNewStartLocal(toParisDateTimeLocal(appointment.start));
    setError("");
    setSuccess("");
  }, [assigningId, reschedulingId, resendingId, statusUpdatingId]);

  const reschedule = useCallback(async (appointment: TeamAppointment) => {
    if (
      !newStartLocal ||
      assigningId ||
      reschedulingId ||
      resendingId ||
      statusUpdatingId
    ) return;
    if (!beginAppointmentMutation()) return;
    setReschedulingId(appointment.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/internal/visio-booking/appointments", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mirrorEventId: appointment.id,
          appointmentIdentity: appointment.identity,
          appointmentStart: appointment.start,
          newStartLocal,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        appointment?: TeamAppointment;
      };
      if (!response.ok || !payload.appointment) {
        throw new Error(payload.error || "Le changement de date a échoué.");
      }
      const updatedAppointment = payload.appointment;
      setAppointments((current) => current
        .map((item) =>
          item.id === appointment.id || item.id === updatedAppointment.id
            ? updatedAppointment
            : item,
        )
        .sort((left, right) => left.start.localeCompare(right.start)));
      setEditingId("");
      setSuccess(
        `${appointment.title} a été déplacé au ${formatDay(updatedAppointment.start)} à ${formatTime(updatedAppointment.start, false)}.`,
      );
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : "Le changement de date a échoué.");
    } finally {
      setReschedulingId("");
      endAppointmentMutation();
    }
  }, [
    assigningId,
    beginAppointmentMutation,
    endAppointmentMutation,
    newStartLocal,
    reschedulingId,
    resendingId,
    statusUpdatingId,
  ]);

  const resendBookingLink = useCallback(async (appointment: TeamAppointment) => {
    if (
      appointment.sourceType !== "booking" ||
      !appointment.meetUrl ||
      assigningId ||
      reschedulingId ||
      resendingId ||
      statusUpdatingId
    ) {
      return;
    }

    const confirmed = await confirmInrcy({
      eyebrow: "ENVOI EXTERNE",
      title: "Renvoyer le lien Google Meet",
      message: "Renvoyer maintenant le lien au professionnel ? Cet envoi est manuel et n’activera aucun rappel automatique.",
      confirmLabel: "Renvoyer le lien",
      cancelLabel: "Annuler",
      variant: "warning",
    });
    if (!confirmed) return;

    const existingDeliveryKey = resendDeliveryKeys.current.get(appointment.id);
    const deliveryKey = existingDeliveryKey || window.crypto.randomUUID();
    resendDeliveryKeys.current.set(appointment.id, deliveryKey);
    setResendingId(appointment.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        "/api/internal/visio-booking/appointments/resend-link",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mirrorEventId: appointment.id,
            appointmentIdentity: appointment.identity,
            appointmentStart: appointment.start,
            deliveryKey,
          }),
        },
      );
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        sent?: boolean;
      };
      if (!response.ok || payload.sent !== true) {
        throw new Error(payload.error || "Le lien n’a pas pu être renvoyé.");
      }
      resendDeliveryKeys.current.delete(appointment.id);
      setSuccess("Le lien Google Meet a été renvoyé manuellement au professionnel.");
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Le lien n’a pas pu être renvoyé.",
      );
    } finally {
      setResendingId("");
    }
  }, [assigningId, reschedulingId, resendingId, statusUpdatingId]);

  const updateStatus = useCallback(async (
    appointment: TeamAppointment,
    status: VisioAppointmentStatus,
  ) => {
    if (
      status === appointment.status ||
      assigningId ||
      reschedulingId ||
      resendingId ||
      statusUpdatingId
    ) {
      return;
    }
    if (!beginAppointmentMutation()) return;
    setStatusUpdatingId(appointment.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/internal/visio-booking/appointments", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mirrorEventId: appointment.id,
          appointmentIdentity: appointment.identity,
          appointmentStart: appointment.start,
          status,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        appointment?: TeamAppointment;
      };
      if (!response.ok || !payload.appointment) {
        throw new Error(payload.error || "Le changement de statut a échoué.");
      }
      const updatedAppointment = payload.appointment;
      setAppointments((current) =>
        current.map((item) =>
          item.id === appointment.id || item.id === updatedAppointment.id
            ? updatedAppointment
            : item,
        ),
      );
      setSuccess(
        `${appointment.title} : ${updatedAppointment.statusLabel.toLowerCase()}.`,
      );
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Le changement de statut a échoué.",
      );
    } finally {
      setStatusUpdatingId("");
      endAppointmentMutation();
    }
  }, [
    assigningId,
    beginAppointmentMutation,
    endAppointmentMutation,
    reschedulingId,
    resendingId,
    statusUpdatingId,
  ]);

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
              width={92}
              height={36}
              className={styles.logo}
              priority
            />
            <div className={styles.headerCopy}>
              <p className={styles.eyebrow}>OUTIL INTERNE</p>
              <h1>Attribution des rendez-vous</h1>
              <div className={styles.headerMeta}>
                <span className={styles.period}>7 jours d’historique et 14 jours à venir</span>
                <span
                  className={styles.safetyChip}
                  title="Une invitation unique est envoyée lors de la réservation sur le site. Les changements restent silencieux et le lien ne peut ensuite être renvoyé que manuellement."
                >
                  ✓ Attribution privée
                </span>
              </div>
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
              disabled={refreshing || Boolean(assigningId) || Boolean(reschedulingId) || Boolean(resendingId) || Boolean(statusUpdatingId)}
            >
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
            <Link href="/dashboard/agenda" className={styles.backLink}>iNrCalendar</Link>
            <Link href="/dashboard/admin" className={styles.closeButton}>Fermer</Link>
          </div>
        </header>

        <div className={styles.toastStack} aria-live="polite">
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          {success ? <div className={styles.success} role="status">{success}</div> : null}
        </div>

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
                        {appointment.managedLifecycle ? (
                          <div className={styles.statusRow}>
                            <span
                              className={styles.statusBadge}
                              data-status={appointment.status}
                            >
                              {appointment.statusLabel}
                            </span>
                            <label className={styles.statusSelectLabel}>
                              <span>Changer le statut</span>
                              <select
                                value={appointment.status}
                                disabled={
                                  Boolean(assigningId) ||
                                  Boolean(reschedulingId) ||
                                  Boolean(resendingId) ||
                                  Boolean(statusUpdatingId) ||
                                  refreshing
                                }
                                onChange={(event) =>
                                  void updateStatus(
                                    appointment,
                                    event.target.value as VisioAppointmentStatus,
                                  )
                                }
                              >
                                <option value={appointment.status}>
                                  {statusUpdatingId === appointment.id
                                    ? "Mise à jour…"
                                    : appointment.statusLabel}
                                </option>
                                {visioAppointmentManualTransitions(
                                  appointment.status,
                                  appointment.origin,
                                ).map((status) => (
                                  <option value={status} key={status}>
                                    {VISIO_APPOINTMENT_STATUS_LABELS[status]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {appointment.status === "signup_pending" ? (
                              <span className={styles.statusHint}>
                                Pour le passer en bleu clair, positionnez sa date et son heure.
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={styles.links}>
                          {appointment.meetUrl ? (
                            <a href={appointment.meetUrl} target="_blank" rel="noreferrer">Ouvrir Google Meet</a>
                          ) : null}
                          {appointment.calendarUrl ? (
                            <a href={appointment.calendarUrl} target="_blank" rel="noreferrer">Voir dans Google Agenda</a>
                          ) : null}
                          {appointment.sourceType === "booking" &&
                          appointment.meetUrl &&
                          new Date(appointment.end).getTime() > Date.now() ? (
                            <button
                              type="button"
                              className={styles.resendLinkButton}
                              disabled={Boolean(assigningId) || Boolean(reschedulingId) || Boolean(resendingId) || Boolean(statusUpdatingId) || refreshing}
                              onClick={() => void resendBookingLink(appointment)}
                            >
                              {resendingId === appointment.id ? "Envoi…" : "Renvoyer le lien"}
                            </button>
                          ) : null}
                          {!appointment.allDay ? (
                            <button
                              type="button"
                              className={styles.scheduleToggle}
                              disabled={Boolean(assigningId) || Boolean(reschedulingId) || Boolean(resendingId) || Boolean(statusUpdatingId) || refreshing}
                              onClick={() => beginReschedule(appointment)}
                            >
                              Modifier date / heure
                            </button>
                          ) : null}
                        </div>
                        {editingId === appointment.id ? (
                          <form
                            className={styles.scheduleEditor}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void reschedule(appointment);
                            }}
                          >
                            <label>
                              <span>Nouvelle date et heure</span>
                              <input
                                type="datetime-local"
                                step="60"
                                value={newStartLocal}
                                onChange={(event) => setNewStartLocal(event.target.value)}
                                disabled={reschedulingId === appointment.id}
                                required
                              />
                            </label>
                            <div className={styles.scheduleEditorCopy}>
                              <strong>Durée conservée : {formatDuration(appointment.start, appointment.end)}</strong>
                              <span>La date sera mise à jour sans e-mail automatique au professionnel.</span>
                            </div>
                            <div className={styles.scheduleEditorActions}>
                              <button
                                type="button"
                                onClick={() => setEditingId("")}
                                disabled={reschedulingId === appointment.id}
                              >
                                Annuler
                              </button>
                              <button
                                type="submit"
                                className={styles.saveScheduleButton}
                                disabled={reschedulingId === appointment.id || !newStartLocal}
                              >
                                {reschedulingId === appointment.id ? "Enregistrement…" : "Enregistrer"}
                              </button>
                            </div>
                          </form>
                        ) : null}
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
                                disabled={active || Boolean(assigningId) || Boolean(reschedulingId) || Boolean(resendingId) || Boolean(statusUpdatingId) || refreshing}
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
