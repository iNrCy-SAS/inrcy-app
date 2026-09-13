import assert from "node:assert/strict";
import test from "node:test";

import {
  VISIO_APPOINTMENT_COLOR_BY_STATUS,
  canExplicitlyConfirmPendingSignup,
  canManuallyTransitionVisioAppointment,
  cancellationStatusFor,
  isPendingSignupGoogleSchedulingIntent,
  isLegacyVisioAppointment,
  lifecyclePrivateProperties,
  scheduledStatusForOrigin,
  visioAppointmentStatusAfterColorChange,
  visioAppointmentStatusForColor,
} from "../../lib/visioAppointmentLifecycle.ts";

test("chaque statut métier possède exactement la couleur Google convenue", () => {
  assert.deepEqual(VISIO_APPOINTMENT_COLOR_BY_STATUS, {
    signup_pending: "5",
    appointment_scheduled_from_signup: "7",
    appointment_scheduled_direct: "9",
    signup_cancelled: "4",
    appointment_cancelled: "11",
    appointment_signed: "10",
  });

  for (const [status, colorId] of Object.entries(
    VISIO_APPOINTMENT_COLOR_BY_STATUS,
  )) {
    assert.equal(visioAppointmentStatusForColor(colorId), status);
  }
});

test("une inscription sans rendez-vous ne devient pas rendez-vous par la couleur seule", () => {
  assert.equal(
    canManuallyTransitionVisioAppointment(
      "signup_pending",
      "appointment_scheduled_from_signup",
      "signup_without_appointment",
    ),
    false,
  );
  assert.equal(
    canManuallyTransitionVisioAppointment(
      "signup_pending",
      "signup_cancelled",
      "signup_without_appointment",
    ),
    true,
  );
  assert.equal(
    scheduledStatusForOrigin("signup_without_appointment"),
    "appointment_scheduled_from_signup",
  );
  assert.equal(
    scheduledStatusForOrigin("signup_with_appointment"),
    "appointment_scheduled_direct",
  );
});

test("une inscription peut être confirmée à son horaire actuel uniquement par une action explicite", () => {
  assert.equal(
    canExplicitlyConfirmPendingSignup({
      from: "signup_pending",
      to: "appointment_scheduled_from_signup",
      confirmed: true,
    }),
    true,
  );
  assert.equal(
    canExplicitlyConfirmPendingSignup({
      from: "signup_pending",
      to: "appointment_scheduled_from_signup",
      confirmed: false,
    }),
    false,
  );
  assert.equal(
    canExplicitlyConfirmPendingSignup({
      from: "appointment_cancelled",
      to: "appointment_scheduled_from_signup",
      confirmed: true,
    }),
    false,
  );
});

test("seuls les événements créés avant le déploiement du cycle sont signalés comme anciens", () => {
  assert.equal(isLegacyVisioAppointment("2026-09-10T20:40:28.000Z"), true);
  assert.equal(isLegacyVisioAppointment("2026-09-10T20:40:29.000Z"), false);
  assert.equal(isLegacyVisioAppointment("date-invalide"), false);
});

test("Google peut positionner une ancienne inscription avec le bleu clair et un invité", () => {
  assert.equal(
    isPendingSignupGoogleSchedulingIntent({
      currentStatus: "signup_pending",
      colorId: "7",
      externalAttendeeCount: 1,
    }),
    true,
  );
  assert.equal(
    isPendingSignupGoogleSchedulingIntent({
      currentStatus: "signup_pending",
      colorId: "7",
      externalAttendeeCount: 0,
    }),
    false,
  );
  assert.equal(
    isPendingSignupGoogleSchedulingIntent({
      currentStatus: "signup_pending",
      colorId: "5",
      externalAttendeeCount: 1,
    }),
    false,
  );
  assert.equal(
    isPendingSignupGoogleSchedulingIntent({
      currentStatus: "appointment_scheduled_from_signup",
      colorId: "7",
      externalAttendeeCount: 1,
    }),
    false,
  );
});

test("annuler garde la distinction entre inscription et rendez-vous", () => {
  assert.equal(cancellationStatusFor("signup_pending"), "signup_cancelled");
  assert.equal(
    cancellationStatusFor("appointment_scheduled_direct"),
    "appointment_cancelled",
  );
  assert.deepEqual(
    lifecyclePrivateProperties({
      status: "appointment_signed",
      origin: "signup_with_appointment",
    }),
    {
      inrcyAppointmentStatus: "appointment_signed",
      inrcyAppointmentOrigin: "signup_with_appointment",
      inrcyAppointmentLifecycleVersion: "v1",
    },
  );
});

test("un changement de couleur Google ne produit qu'une transition métier autorisée", () => {
  assert.equal(
    visioAppointmentStatusAfterColorChange({
      currentStatus: "appointment_scheduled_direct",
      origin: "signup_with_appointment",
      colorId: "10",
    }),
    "appointment_signed",
  );
  assert.equal(
    visioAppointmentStatusAfterColorChange({
      currentStatus: "appointment_cancelled",
      origin: "signup_with_appointment",
      colorId: "9",
    }),
    "appointment_scheduled_direct",
  );
  assert.equal(
    visioAppointmentStatusAfterColorChange({
      currentStatus: "signup_pending",
      origin: "signup_without_appointment",
      colorId: "7",
    }),
    "signup_pending",
  );
  assert.equal(
    visioAppointmentStatusAfterColorChange({
      currentStatus: "appointment_scheduled_direct",
      origin: "signup_with_appointment",
      colorId: "3",
    }),
    "appointment_scheduled_direct",
  );
});
