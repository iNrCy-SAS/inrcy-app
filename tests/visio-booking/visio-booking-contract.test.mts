import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(path, "utf8");
}

test("l'inscription renvoie un jeton de réservation sans second appel WordPress", () => {
  const signup = read("app/api/public/trial-signup/route.ts");
  const plugin = read("ops/wordpress-visio-booking/inrcy-visio-booking.php");
  assert.match(signup, /createVisioBookingToken/);
  assert.match(signup, /booking_token:\s*bookingToken/);
  assert.match(plugin, /http_api_debug/);
  assert.doesNotMatch(plugin, /wp_remote_post\s*\(/);
});

test("le nouveau OAuth visio reste séparé de l'ancien connecteur iNrCalendar supprimé", () => {
  const oldStart = read("app/api/integrations/google-calendar/start/route.ts");
  const start = read("app/api/admin/visio-booking/google/start/route.ts");
  assert.match(oldStart, /status:\s*410/);
  assert.match(start, /VISIO_BOOKING_GOOGLE_SCOPES/);
  assert.match(start, /createVisioBookingOAuthState/);
  assert.match(start, /state:\s*oauthState/);
  assert.doesNotMatch(start, /makeOAuthState/);
  assert.doesNotMatch(start, /\/api\/integrations\/google-calendar/);
});

test("la réservation impose capacité deux, Meet et invitations", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  assert.match(backend, /VISIO_BOOKING_MAX_CONCURRENT/);
  assert.match(backend, /conferenceDataVersion=1&sendUpdates=all/);
  assert.match(backend, /conferenceSolutionKey:\s*\{ type: "hangoutsMeet" \}/);
  assert.match(backend, /assignedMemberId/);
  assert.match(backend, /INRCY_VISIO_SHARED_CALENDAR_ID/);
});

test("la modale contient les deux choix et le parcours de confirmation", () => {
  const script = read("ops/wordpress-visio-booking/inrcy-visio-booking.js");
  assert.match(script, /Choisir mon créneau/);
  assert.match(script, /Non, continuer sans rendez-vous/);
  assert.match(script, /Confirmer ce rendez-vous/);
  assert.match(script, /submit_success\.inrcyVisioBooking/);
});
