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
  const eventPolicy = read("lib/visioBookingEventPolicy.ts");
  const lifecycle = read("lib/visioAppointmentLifecycle.ts");
  assert.match(backend, /VISIO_BOOKING_MAX_CONCURRENT/);
  assert.match(backend, /listAllBookingEvents\(rangeStart, rangeEnd\)/);
  assert.match(backend, /listAllBookingEvents\(loadRangeStart, loadRangeEnd\)/);
  assert.match(backend, /conferenceDataVersion=1&sendUpdates=all/);
  assert.match(backend, /conferenceSolutionKey:\s*\{ type: "hangoutsMeet" \}/);
  assert.match(backend, /assignedMemberId/);
  assert.match(backend, /INRCY_VISIO_SHARED_CALENDAR_ID/);
  assert.match(lifecycle, /appointment_scheduled_direct:\s*"9"/);
  assert.match(lifecycle, /appointment_scheduled_from_signup:\s*"7"/);
  assert.match(backend, /PUBLIC_BOOKING_ASSIGNEE\s*=\s*"Équipe iNrCy"/);
  assert.match(eventPolicy, /summary:\s*`Inscription iNrCy - \$\{professionalLabel\}`/);
  assert.match(eventPolicy, /`E-mail : \$\{safe\.email \|\| "—"\}`/);
  assert.match(backend, /guestsCanSeeOtherGuests:\s*false/);
  assert.match(backend, /reminders:\s*\{[\s\S]*?useDefault:\s*false,[\s\S]*?overrides:\s*\[\]/);
  assert.doesNotMatch(backend, /Rendez-vous attribué à : \$\{input\.member\.name\}/);
  assert.match(backend, /removePendingSignupRemindersForProspect/);
  assert.match(backend, /pendingSignupReminderProspectUserId/);
});

test("une inscription devient un seul événement partagé avec Meet et invités", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  const mirror = read("lib/visioCalendarMirrorPolicy.ts");
  const eventPolicy = read("lib/visioBookingEventPolicy.ts");
  const creation = backend.slice(
    backend.indexOf("async function createGoogleBookingEvent"),
    backend.indexOf("export async function bookVisioSlot"),
  );
  assert.match(
    creation,
    /encodeCalendarId\(sharedCalendarId\)[\s\S]*?conferenceDataVersion=1&sendUpdates=all/,
  );
  assert.match(creation, /findPendingSignupReminder\(input\.claims\)/);
  assert.match(creation, /PRIVATE_BOOKING_SINGLE_EVENT_KEY/);
  assert.match(creation, /TEAM_CALENDAR_MIRROR_KEY/);
  assert.match(
    creation,
    /const bookingOrigin: VisioAppointmentOrigin = "signup_with_appointment"/,
  );
  assert.match(creation, /email:\s*prospect\.email/);
  assert.match(creation, /teamMembers:\s*\[\]/);
  assert.match(creation, /\.\.\.publicContent/);
  assert.match(creation, /buildSingleAssigneeVisioAttendees/);
  assert.doesNotMatch(
    backend.slice(backend.indexOf("export async function bookVisioSlot")),
    /sendUpdates=all/,
  );
  assert.match(eventPolicy, /member\.id !== input\.assignedMemberId/);
  assert.doesNotMatch(creation, /bookingCompanionEventId/);
  assert.doesNotMatch(creation, /upsertTeamMirrorEvent/);
  assert.match(backend, /getExistingBooking\(eventId, claims\)/);
  assert.match(backend, /for \(const member of getVisioTeamMembers\(\)\)/);
  assert.match(backend, /syncManagedCalendarReplicas\(event\)/);
  assert.match(backend, /PRIVATE_CALENDAR_REPLICA_KEY/);
  assert.match(backend, /PRIVATE_LOGICAL_APPOINTMENT_KEY/);
  assert.match(
    backend,
    /const sharedEvent = await getCalendarEvent\(getVisioSharedCalendarId\(\), eventId\)/,
  );
  assert.match(backend, /acquireBookingLock\(`identity:\$\{eventId\}`\)/);
  assert.match(backend, /acquireBookingLock\(`slot:\$\{start\.toISOString\(\)\}`\)/);
  assert.match(backend, /BOOKING_LOCK_TTL_SECONDS\s*=\s*120/);
  assert.match(backend, /REDIS_COMPARE_DELETE_SCRIPT/);
  assert.match(backend, /visio_booking_cancelled/);
  assert.match(backend, /properties\.bookingNonce !== claims\.nonce/);
  assert.doesNotMatch(mirror, /attendees\s*:/);
  assert.doesNotMatch(mirror, /conferenceSolutionKey/);
  assert.match(backend, /canonical\.conferenceData/);
});

test("le calendrier partagé global est synchronisé par un cron protégé et idempotent", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  const inrCalendarSync = read("lib/inrCalendarGoogleSync.ts");
  const route = read("app/api/cron/visio-calendar-sync/route.ts");
  const vercel = read("vercel.json");
  assert.match(route, /isAuthorizedCronRequest/);
  assert.match(route, /hasHeaderCredential/);
  assert.match(route, /status:\s*ok \? 200 : 503/);
  assert.match(route, /syncVisioTeamCalendarsToShared/);
  assert.match(route, /syncVisioSharedCalendarToInrCalendar/);
  assert.match(route, /ensureVisioCalendarWatches/);
  assert.match(vercel, /\/api\/cron\/visio-calendar-sync/);
  assert.match(vercel, /"schedule": "\*\/1 \* \* \* \*"/);
  const webhook = read("app/api/webhooks/google-calendar/route.ts");
  const watch = read("lib/visioCalendarWatch.ts");
  assert.match(webhook, /x-goog-channel-token/);
  assert.match(webhook, /after\(async/);
  assert.match(backend, /events\/watch/);
  assert.match(watch, /timingSafeEqual/);
  assert.match(backend, /inrcy:visio-booking:team-calendar-sync/);
  assert.match(backend, /sourceFingerprint/);
  assert.match(backend, /showDeleted:\s*true/);
  assert.match(backend, /cancelSharedCalendarEvent/);
  assert.match(backend, /cancelDuplicatePendingSignupReminders/);
  assert.match(backend, /preferredActiveAppointmentMirrors/);
  assert.match(backend, /reconcileSharedAppointmentDuplicates/);
  assert.match(backend, /canonicalAssignmentEvents/);
  assert.match(backend, /getVisioSharedCalendarAccess/);
  assert.match(inrCalendarSync, /INR_CALENDAR_GOOGLE_SOURCE/);
  assert.match(inrCalendarSync, /getVisioBookingIntegrationAccountId/);
  assert.match(inrCalendarSync, /\.from\("inrcy_accounts"\)/);
  assert.doesNotMatch(inrCalendarSync, /INRCY_ADMIN_USER_ID/);
  assert.match(inrCalendarSync, /\.upsert\(batch, \{ onConflict: "id", ignoreDuplicates: false \}\)/);
  assert.match(inrCalendarSync, /\.contains\("meta", \{ source: INR_CALENDAR_GOOGLE_SOURCE \}\)/);
  assert.match(inrCalendarSync, /staleIds/);
  assert.match(inrCalendarSync, /canonicalEvents/);
  assert.match(inrCalendarSync, /buildInrCalendarCanonicalEventId/);
  assert.match(inrCalendarSync, /deduplicated/);
});

test("les répliques inchangées sont regroupées sans perdre un canonique hors fenêtre", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  const teamSync = backend.slice(
    backend.indexOf("export async function syncVisioTeamCalendarsToShared"),
    backend.indexOf("async function readFreeBusy"),
  );
  const replicaReconciliation = backend.slice(
    backend.indexOf("async function reconcileManagedCalendarReplica"),
    backend.indexOf("async function moveCalendarEventWithoutUpdates"),
  );
  assert.match(
    replicaReconciliation,
    /managedCanonicalById\.get\(canonicalEventId\)[\s\S]*?else \{[\s\S]*?canonicalFetches \+= 1;[\s\S]*?getCalendarEvent/,
  );
  const stableBranch = replicaReconciliation.match(
    /if \(decision === "stable"\) \{[\s\S]*?\n  \}/,
  )?.[0] || "";
  assert.match(stableBranch, /return "unchanged" as const/);
  assert.doesNotMatch(
    stableBranch,
    /getCalendarEvent|patchCalendarEvent|upsertManagedCalendarReplica|syncManagedCalendarReplicas/,
  );
  assert.match(
    teamSync,
    /!successfullyListedMemberIds\.has\(member\.id\)[\s\S]*?seenManagedReplicaKeys\.has\(managedReplicaKey\(member\.id, canonical\.id\)\)[\s\S]*?missingReplicaChecks \+= 1;[\s\S]*?const replicaId = calendarReplicaEventId\(canonical\)/,
  );
  assert.match(
    teamSync,
    /createManagedCalendarReplica\(canonical, member\)[\s\S]*?kind: "conflict"[\s\S]*?getCalendarEvent\(member\.calendarId, replicaId\)[\s\S]*?visio_calendar_replica_id_conflict[\s\S]*?reconcileManagedCalendarReplica\([\s\S]*?replicaForReconciliation,/,
  );
  assert.match(
    teamSync,
    /sourceEventsByMemberId\.set\(member\.id, sourceEvents\)[\s\S]*?canonicalIdsToLoad[\s\S]*?managedCanonicalByReplicaId\.set\(replicaId, canonical\)/,
  );
  assert.doesNotMatch(teamSync, /for \(const canonicalEventId[\s\S]*?syncManagedCalendarReplicas/);
  assert.match(
    replicaReconciliation,
    /managedCanonicalById\.set\(canonicalEventId, normalized\);[\s\S]*?fullySyncedManagedCanonicalIds\.add\(canonicalEventId\);/,
  );
  assert.match(
    teamSync,
    /logicalAppointmentId\(recoveredCanonical\) === logicalAppointmentId\(event\)[\s\S]*?managedCanonicalById\.set\(canonicalEventId, recoveredCanonical\)/,
  );
  const canonicalPreload = teamSync.indexOf("[...canonicalIdsToLoad].map");
  const postPreloadAlias = teamSync.indexOf(
    "failedManagedCanonicalIds.delete(canonicalEventId)",
    canonicalPreload,
  );
  const reconciliationPass = teamSync.indexOf(
    "for (const member of teamMembers)",
    postPreloadAlias,
  );
  assert.ok(canonicalPreload >= 0);
  assert.ok(postPreloadAlias > canonicalPreload);
  assert.ok(reconciliationPass > postPreloadAlias);
  assert.match(
    teamSync.slice(canonicalPreload, reconciliationPass),
    /managedCanonicalByReplicaId\.get\(event\.id\)[\s\S]*?logicalAppointmentId\(recoveredCanonical\) === logicalAppointmentId\(event\)[\s\S]*?managedCanonicalById\.set\(canonicalEventId, recoveredCanonical\);[\s\S]*?failedManagedCanonicalIds\.delete\(canonicalEventId\);/,
  );
  assert.match(
    teamSync,
    /catch \(error\) \{[\s\S]*?failedManagedCanonicalIds\.add\(canonicalEventId\);/,
  );
  assert.match(
    replicaReconciliation,
    /if \(failedManagedCanonicalIds\.has\(canonicalEventId\)\) \{[\s\S]*?return "skipped" as const;/,
  );
  assert.match(teamSync, /MANAGED_REPLICA_CREATE_CONCURRENCY/);
});

test("les mutations agenda attendent brièvement le verrou sans ralentir le cron", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  const teamSync = backend.slice(
    backend.indexOf("export async function syncVisioTeamCalendarsToShared"),
    backend.indexOf("async function readFreeBusy"),
  );
  assert.match(backend, /TEAM_CALENDAR_MUTATION_LOCK_WAIT_MS = 8_000/);
  assert.match(backend, /TEAM_CALENDAR_MUTATION_LOCK_RETRY_MS = 250/);
  assert.match(
    backend,
    /function acquireTeamCalendarMutationLock\(\)[\s\S]*?waitMs: TEAM_CALENDAR_MUTATION_LOCK_WAIT_MS,[\s\S]*?retryMs: TEAM_CALENDAR_MUTATION_LOCK_RETRY_MS/,
  );
  assert.match(teamSync, /acquireTeamCalendarSyncLock\(\)/);
  assert.doesNotMatch(teamSync, /acquireTeamCalendarMutationLock/);
  assert.equal(
    backend.match(/await acquireTeamCalendarMutationLock\(\)/g)?.length,
    3,
  );
});

test("le compte admin ouvre Google Agenda et les copies Google restent en lecture seule", () => {
  const page = read("app/dashboard/agenda/page.tsx");
  const client = read("app/dashboard/agenda/AgendaClient.tsx");
  const ui = read("app/dashboard/agenda/agenda.ui.tsx");
  const eventsRoute = read("app/api/calendar/events/route.ts");

  assert.match(page, /canOpenGoogleAgenda=\{role\.isAdmin\}/);
  assert.match(ui, /desktopLabel="Google Agenda"/);
  assert.match(ui, /Admin — Attribution des rendez-vous/);
  assert.match(ui, /onClick=\{onOpenTeamAppointments\}/);
  assert.match(client, /https:\/\/calendar\.google\.com\/calendar\/u\/0\/r/);
  assert.match(client, /refreshGoogle/);
  assert.match(client, /isGoogleSyncedEvent\(event\)/);
  assert.match(eventsRoute, /Modifiez-le dans Google Agenda/);
  assert.match(eventsRoute, /Supprimez-le dans Google Agenda/);
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
  assert.match(script, /Prévoyez environ une heure/);
  assert.match(plugin, /logoUrl.*logo-inrcy-transparent\.png/);
  assert.match(script, /inrcy-visio-brand[^\n]+<span>iNrCy<\/span>/);
  assert.match(script, /rendez-vous aura lieu avec <strong>un membre de l’équipe iNrCy<\/strong>/);
  assert.doesNotMatch(script, /booking\.assignedTo/);
  assert.match(styles, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.inrcy-visio-dialog\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.inrcy-visio-overlay\s*\{[\s\S]*?align-items:\s*center/,
  );
  assert.match(script, /submit_success\.inrcyVisioBooking/);
});

test("le délai par défaut autorise les réservations dès le lendemain", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  assert.match(backend, /INRCY_VISIO_MINIMUM_LEAD_DAYS",\s*1,/);
});

test("l’attribution équipe est privée, auditée et silencieuse pour le professionnel", () => {
  const backend = read("lib/visioBookingGoogle.ts");
  const access = read("lib/visioTeamAccess.ts");
  const route = read("app/api/internal/visio-booking/appointments/route.ts");
  const resendRoute = read("app/api/internal/visio-booking/appointments/resend-link/route.ts");
  const page = read("app/equipe/agenda/TeamAgendaClient.tsx");
  const adminHome = read("app/dashboard/admin/page.tsx");

  assert.match(access, /getVisioTeamAllowedEmails/);
  assert.match(access, /ADMIN_USER_IDS/);
  assert.match(access, /profile\?\.role === "admin"/);
  assert.match(access, /Accès réservé à l’équipe iNrCy/);
  assert.match(route, /requireVisioTeamApi/);
  assert.match(route, /sec-fetch-site/);
  assert.match(route, /reassignVisioTeamAppointment/);
  assert.match(route, /rescheduleVisioTeamAppointment/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /newStartLocal/);
  assert.match(route, /appointmentIdentity/);
  assert.match(route, /appointmentStart/);
  assert.match(route, /syncVisioSharedCalendarToInrCalendar/);
  assert.match(resendRoute, /requireVisioTeamApi/);
  assert.match(resendRoute, /resendVisioBookingLink/);
  assert.match(resendRoute, /deliveryKey/);
  assert.match(resendRoute, /sec-fetch-site/);
  assert.match(route, /inrCalendarSynced/);
  assert.match(route, /pastDays:\s*7/);
  assert.match(route, /futureDays:\s*14/);
  assert.match(route, /searchParams\.get\("refresh"\) === "1"/);
  assert.match(route, /refresh,/);
  assert.match(backend, /moveCalendarEventWithoutUpdates/);
  assert.match(backend, /identity: appointmentIdentity\(event\)/);
  assert.match(backend, /resolveActiveTeamAppointmentMirror/);
  assert.match(backend, /appointmentIdentity\(event\) !== identity/);
  assert.match(backend, /eventOrganizerMatchesMember\(event, member\)/);
  assert.match(backend, /appointmentIdentity\(event\) === referenceIdentity/);
  assert.match(backend, /findBookingCompanions/);
  assert.match(backend, /cancelCalendarEventWithoutUpdates/);
  assert.match(backend, /targetUsesPublicCalendar/);
  assert.match(backend, /memberUsesPublicCalendar/);
  assert.match(backend, /teamCalendarExternalAttendees/);
  assert.match(backend, /sourceCalendarIsOrganizer/);
  assert.match(backend, /sendUpdates:\s*"none"/);
  assert.match(backend, /publicOrganizerPreserved:\s*isBooking/);
  assert.match(backend, /notificationsSent:\s*false/);
  assert.match(backend, /type:\s*"appointment_reassigned"/);
  assert.match(backend, /type:\s*"appointment_rescheduled"/);
  assert.doesNotMatch(backend, /patchCalendarEventWithUpdates/);
  assert.match(backend, /sendUpdates=\$\{sendUpdates\}/);
  assert.match(backend, /buildTimedEventSchedule/);
  assert.match(backend, /previousEndMs - previousStartMs/);
  assert.match(backend, /rescheduleAutomaticBooking/);
  assert.match(backend, /rescheduleCalendarAppointment/);
  assert.match(backend, /convertPendingSignupToScheduledAppointment/);
  assert.match(backend, /"appointment_scheduled_from_signup"/);
  assert.match(backend, /resendVisioBookingLink/);
  assert.match(backend, /VISIO_BOOKING_MANUAL_RESEND_SCOPE/);
  assert.match(backend, /completeExecutionIdempotencyLockOrThrow/);
  assert.match(backend, /type:\s*"appointment_link_resent"/);
  assert.match(backend, /hasAutomaticGoogleCalendarReminders/);
  assert.match(page, /Jimmy|member\.name/);
  assert.match(page, /Une invitation unique est envoyée/);
  assert.match(page, /Renvoyer le lien/);
  assert.match(page, /confirmInrcy/);
  assert.match(page, /aucun rappel automatique/i);
  assert.match(page, /7 jours d’historique et 14 jours à venir/);
  assert.match(page, /appointments\?refresh=1/);
  assert.match(page, /currentMemberId:\s*target\.id/);
  assert.match(page, /appointmentIdentity: appointment\.identity/);
  assert.match(page, /appointmentStart: appointment\.start/);
  assert.match(page, /type="datetime-local"/);
  assert.match(page, /Modifier date \/ heure/);
  assert.match(page, /Durée conservée/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.match(adminHome, /href:\s*"\/equipe\/agenda"/);
  assert.match(adminHome, /Attribution des rendez-vous/);
});
