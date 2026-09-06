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
  assert.match(backend, /listAllBookingEvents\(rangeStart, rangeEnd\)/);
  assert.match(backend, /listAllBookingEvents\(loadRangeStart, loadRangeEnd\)/);
  assert.match(backend, /conferenceDataVersion=1&sendUpdates=all/);
  assert.match(backend, /conferenceSolutionKey:\s*\{ type: "hangoutsMeet" \}/);
  assert.match(backend, /assignedMemberId/);
  assert.match(backend, /INRCY_VISIO_SHARED_CALENDAR_ID/);
});

test("les nouveaux rendez-vous sont organisés par le membre puis reflétés sans invitation", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  const mirror = read("lib/visioCalendarMirrorPolicy.ts");
  assert.match(
    backend,
    /encodeCalendarId\(input\.member\.calendarId\)[\s\S]*?conferenceDataVersion=1&sendUpdates=all/,
  );
  assert.match(backend, /attendees:\s*\[\{ email: prospect\.email/);
  assert.match(backend, /upsertTeamMirrorEvent/);
  assert.match(backend, /sendUpdates=none/);
  assert.match(backend, /getExistingBooking\(eventId\)/);
  assert.match(backend, /for \(const member of getVisioTeamMembers\(\)\)/);
  assert.match(backend, /if \(event && event\.status !== "cancelled"\) return event/);
  assert.match(backend, /acquireBookingLock\(`identity:\$\{eventId\}`\)/);
  assert.match(backend, /acquireBookingLock\(`slot:\$\{start\.toISOString\(\)\}`\)/);
  assert.match(backend, /BOOKING_LOCK_TTL_SECONDS\s*=\s*120/);
  assert.match(backend, /REDIS_COMPARE_DELETE_SCRIPT/);
  assert.match(backend, /visio_booking_cancelled/);
  assert.match(backend, /properties\.bookingNonce !== input\.claims\.nonce/);
  assert.doesNotMatch(mirror, /attendees\s*:/);
  assert.doesNotMatch(mirror, /conferenceData\s*:/);
});

test("le calendrier partagé global est synchronisé par un cron protégé et idempotent", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  const route = read("app/api/cron/visio-calendar-sync/route.ts");
  const vercel = read("vercel.json");
  assert.match(route, /isAuthorizedCronRequest/);
  assert.match(route, /hasHeaderCredential/);
  assert.match(route, /status:\s*result\.ok \? 200 : 503/);
  assert.match(route, /syncVisioTeamCalendarsToShared/);
  assert.match(vercel, /\/api\/cron\/visio-calendar-sync/);
  assert.match(vercel, /"schedule": "\*\/5 \* \* \* \*"/);
  assert.match(backend, /inrcy:visio-booking:team-calendar-sync/);
  assert.match(backend, /sourceFingerprint/);
  assert.match(backend, /showDeleted:\s*true/);
  assert.match(backend, /cancelTeamMirrorEvent/);
  assert.match(backend, /getVisioSharedCalendarAccess/);
});

test("la modale contient les deux choix et le parcours de confirmation", () => {
  const plugin = read("ops/wordpress-visio-booking/inrcy-visio-booking.php");
  const script = read("ops/wordpress-visio-booking/inrcy-visio-booking.js");
  const styles = read("ops/wordpress-visio-booking/inrcy-visio-booking.css");
  assert.match(plugin, /INRCY_VISIO_BOOKING_PUBLIC_OPTION/);
  assert.match(plugin, /inrcy_visio_booking_frontend_enabled/);
  assert.match(plugin, /inrcy_visio_test/);
  assert.match(plugin, /current_user_can\('manage_options'\)/);
  assert.match(script, /Choisir mon créneau/);
  assert.match(script, /Non, continuer sans rendez-vous/);
  assert.match(script, /Confirmer ce rendez-vous/);
  assert.match(script, /DAYS_PER_WEEK\s*=\s*7/);
  assert.match(script, /data-action="week-prev"/);
  assert.match(script, /data-action="week-next"/);
  assert.match(script, /Prévoyez au moins une heure/);
  assert.match(plugin, /logoUrl.*logo-inrcy-transparent\.png/);
  assert.match(script, /inrcy-visio-brand[^\n]+<span>iNrCy<\/span>/);
  assert.match(script, /rendez-vous aura lieu avec <strong>un membre de l’équipe iNrCy<\/strong>/);
  assert.doesNotMatch(script, /booking\.assignedTo/);
  assert.match(styles, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.inrcy-visio-dialog\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(script, /submit_success\.inrcyVisioBooking/);
});

test("le délai par défaut autorise les réservations dès le lendemain", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  assert.match(backend, /INRCY_VISIO_MINIMUM_LEAD_DAYS",\s*1,/);
});
