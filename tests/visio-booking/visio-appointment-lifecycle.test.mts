import assert from "node:assert/strict";
import test from "node:test";

import {
  VISIO_APPOINTMENT_COLOR_BY_STATUS,
  canManuallyTransitionVisioAppointment,
  cancellationStatusFor,
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

test("une inscription sans rendez-vous ne devient rendez-vous que par la date et l'heure", () => {
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
