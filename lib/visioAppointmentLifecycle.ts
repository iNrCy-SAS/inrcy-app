export const VISIO_APPOINTMENT_STATUS_KEY = "inrcyAppointmentStatus";
export const VISIO_APPOINTMENT_ORIGIN_KEY = "inrcyAppointmentOrigin";
export const VISIO_APPOINTMENT_LIFECYCLE_VERSION_KEY =
  "inrcyAppointmentLifecycleVersion";
export const VISIO_APPOINTMENT_LIFECYCLE_VERSION = "v1";

export const VISIO_APPOINTMENT_STATUSES = [
  "signup_pending",
  "appointment_scheduled_from_signup",
  "appointment_scheduled_direct",
  "signup_cancelled",
  "appointment_cancelled",
  "appointment_signed",
] as const;

export type VisioAppointmentStatus =
  (typeof VISIO_APPOINTMENT_STATUSES)[number];

export const VISIO_APPOINTMENT_ORIGINS = [
  "signup_without_appointment",
  "signup_with_appointment",
] as const;

export type VisioAppointmentOrigin =
  (typeof VISIO_APPOINTMENT_ORIGINS)[number];

/**
 * Google Calendar exposes eleven fixed event colours. We intentionally use
 * event colours (not calendar colours), so the lifecycle looks identical in
 * the shared calendar and in every internal replica.
 */
export const VISIO_APPOINTMENT_COLOR_BY_STATUS: Record<
  VisioAppointmentStatus,
  string
> = {
  signup_pending: "5", // Banana / yellow
  appointment_scheduled_from_signup: "7", // Peacock / light blue
  appointment_scheduled_direct: "9", // Blueberry / dark blue
  signup_cancelled: "4", // Flamingo / light red
  appointment_cancelled: "11", // Tomato / dark red
  appointment_signed: "10", // Basil / green
};

export const VISIO_APPOINTMENT_STATUS_LABELS: Record<
  VisioAppointmentStatus,
  string
> = {
  signup_pending: "Inscription sans rendez-vous",
  appointment_scheduled_from_signup: "Rendez-vous positionné",
  appointment_scheduled_direct: "Inscription avec rendez-vous",
  signup_cancelled: "Inscription annulée",
  appointment_cancelled: "Rendez-vous annulé",
  appointment_signed: "Rendez-vous fait et signé",
};

const STATUS_BY_COLOR = new Map(
  Object.entries(VISIO_APPOINTMENT_COLOR_BY_STATUS).map(([status, colorId]) => [
    colorId,
    status as VisioAppointmentStatus,
  ]),
);

export function isVisioAppointmentStatus(
  value: unknown,
): value is VisioAppointmentStatus {
  return VISIO_APPOINTMENT_STATUSES.includes(
    String(value || "") as VisioAppointmentStatus,
  );
}

export function isVisioAppointmentOrigin(
  value: unknown,
): value is VisioAppointmentOrigin {
  return VISIO_APPOINTMENT_ORIGINS.includes(
    String(value || "") as VisioAppointmentOrigin,
  );
}

export function visioAppointmentStatusForColor(
  colorId: unknown,
): VisioAppointmentStatus | null {
  return STATUS_BY_COLOR.get(String(colorId || "").trim()) || null;
}

export function visioAppointmentColorId(status: VisioAppointmentStatus) {
  return VISIO_APPOINTMENT_COLOR_BY_STATUS[status];
}

export function visioAppointmentOriginForStatus(
  status: VisioAppointmentStatus,
): VisioAppointmentOrigin {
  return status === "appointment_scheduled_direct"
    ? "signup_with_appointment"
    : "signup_without_appointment";
}

export function scheduledStatusForOrigin(origin: VisioAppointmentOrigin) {
  return origin === "signup_with_appointment"
    ? ("appointment_scheduled_direct" as const)
    : ("appointment_scheduled_from_signup" as const);
}

export function cancellationStatusFor(
  status: VisioAppointmentStatus,
): VisioAppointmentStatus {
  return status === "signup_pending"
    ? "signup_cancelled"
    : "appointment_cancelled";
}

/**
 * Status changes exposed to the internal attribution screen. Scheduling a
 * pending signup is intentionally absent: that transition must go through the
 * date/time action so the existing event receives its single Meet link and its
 * one initial invitation.
 */
export function visioAppointmentManualTransitions(
  status: VisioAppointmentStatus,
  origin: VisioAppointmentOrigin = visioAppointmentOriginForStatus(status),
): VisioAppointmentStatus[] {
  const scheduled = scheduledStatusForOrigin(origin);
  switch (status) {
    case "signup_pending":
      return ["signup_cancelled"];
    case "signup_cancelled":
      return ["signup_pending"];
    case "appointment_scheduled_from_signup":
    case "appointment_scheduled_direct":
      return ["appointment_signed", "appointment_cancelled"];
    case "appointment_cancelled":
      return [scheduled, "appointment_signed"];
    case "appointment_signed":
      return [scheduled, "appointment_cancelled"];
  }
}

export function canManuallyTransitionVisioAppointment(
  from: VisioAppointmentStatus,
  to: VisioAppointmentStatus,
  origin: VisioAppointmentOrigin = visioAppointmentOriginForStatus(from),
) {
  return visioAppointmentManualTransitions(from, origin).includes(to);
}

/**
 * Google Agenda users can express the same business transition by changing
 * the event colour. Only colours that map to an allowed lifecycle transition
 * are accepted; decorative or accidental colours never corrupt the status.
 */
export function visioAppointmentStatusAfterColorChange(input: {
  currentStatus: VisioAppointmentStatus;
  origin?: VisioAppointmentOrigin;
  colorId: unknown;
}) {
  const requestedStatus = visioAppointmentStatusForColor(input.colorId);
  if (
    requestedStatus &&
    requestedStatus !== input.currentStatus &&
    canManuallyTransitionVisioAppointment(
      input.currentStatus,
      requestedStatus,
      input.origin,
    )
  ) {
    return requestedStatus;
  }
  return input.currentStatus;
}

export function lifecyclePrivateProperties(input: {
  status: VisioAppointmentStatus;
  origin?: VisioAppointmentOrigin;
}) {
  return {
    [VISIO_APPOINTMENT_STATUS_KEY]: input.status,
    [VISIO_APPOINTMENT_ORIGIN_KEY]:
      input.origin || visioAppointmentOriginForStatus(input.status),
    [VISIO_APPOINTMENT_LIFECYCLE_VERSION_KEY]:
      VISIO_APPOINTMENT_LIFECYCLE_VERSION,
  };
}
