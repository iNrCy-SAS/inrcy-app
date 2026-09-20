(function inrcyVisioBooking($) {
  "use strict";

  var config = window.inrcyVisioBookingConfig || {};
  var currentToken = "";
  var dialogRoot = null;
  var previouslyFocused = null;
  var selectedStart = "";
  var availability = [];
  var currentWeekPage = 0;
  var currentStep = 1;
  var bookingSurface = "signup_success";
  var bookingSessionId = "";
  var hasCompletedBooking = false;
  var DAYS_PER_PAGE = 6;
  var BOOKING_TOKEN_STORAGE_KEY = "inrcy_visio_booking_token";
  var BOOKING_COMPLETED_STORAGE_KEY = "inrcy_visio_booking_completed_until";
  var BOOKING_COMPLETED_TTL_MS = 21 * 24 * 60 * 60 * 1000;
  var ATTRIBUTION_QUERY_KEYS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
    "placement", "site_source_name", "fbclid", "gclid",
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function findBookingToken(value, depth) {
    if (!value || depth > 5) return "";
    if (typeof value === "object") {
      if (typeof value.inrcy_booking_token === "string") {
        return value.inrcy_booking_token;
      }
      var keys = Object.keys(value);
      for (var index = 0; index < keys.length; index += 1) {
        var found = findBookingToken(value[keys[index]], depth + 1);
        if (found) return found;
      }
    }
    return "";
  }

  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function (character) {
      return (Number(character) ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(character) / 4)))).toString(16);
    });
  }

  function trackFunnel(eventName, step, metadata) {
    if (!config.trackingUrl || !currentToken) return;
    var details = Object.assign({
      surface: bookingSurface,
      viewport: window.innerWidth + "x" + window.innerHeight,
    }, metadata || {});
    fetch(config.trackingUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: currentToken,
        eventId: randomUuid(),
        eventName: eventName,
        sessionId: bookingSessionId,
        step: step,
        metadata: details,
      }),
      credentials: "omit",
      cache: "no-store",
      keepalive: true,
    }).catch(function () {});
  }

  function readSessionBookingToken() {
    try {
      return String(window.sessionStorage.getItem(BOOKING_TOKEN_STORAGE_KEY) || "");
    } catch {
      return "";
    }
  }

  function rememberSessionBookingToken(token) {
    try {
      window.sessionStorage.setItem(BOOKING_TOKEN_STORAGE_KEY, token);
    } catch {}
  }

  function forgetSessionBookingToken() {
    currentToken = "";
    try {
      window.sessionStorage.removeItem(BOOKING_TOKEN_STORAGE_KEY);
    } catch {}
  }

  function bookingWasRecentlyCompleted() {
    try {
      var completedUntil = Number(window.localStorage.getItem(BOOKING_COMPLETED_STORAGE_KEY) || 0);
      if (Number.isFinite(completedUntil) && completedUntil > Date.now()) return true;
      window.localStorage.removeItem(BOOKING_COMPLETED_STORAGE_KEY);
    } catch {}
    return false;
  }

  function rememberCompletedBooking() {
    forgetSessionBookingToken();
    try {
      window.localStorage.setItem(
        BOOKING_COMPLETED_STORAGE_KEY,
        String(Date.now() + BOOKING_COMPLETED_TTL_MS)
      );
    } catch {}
  }

  function signupForm() {
    var expectedName = String(config.signupFormName || "").trim();
    var forms = Array.prototype.slice.call(document.querySelectorAll("form"));
    for (var index = 0; index < forms.length; index += 1) {
      if (expectedName && forms[index].getAttribute("name") === expectedName) return forms[index];
    }
    return document.querySelector("form.elementor-form");
  }

  function scrollToSignupForm() {
    var form = signupForm();
    if (!form) return false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(function () {
      var firstField = form.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      if (firstField && typeof firstField.focus === "function") firstField.focus({ preventScroll: true });
    }, 450);
    return true;
  }

  function signupDestination() {
    var destination = new URL(config.signupUrl || "/inscription/?lang=fr", window.location.origin);
    var currentParameters = new URLSearchParams(window.location.search);
    ATTRIBUTION_QUERY_KEYS.forEach(function (key) {
      var value = currentParameters.get(key);
      if (value && !destination.searchParams.has(key)) destination.searchParams.set(key, value);
    });
    destination.hash = "inrcy-inscription";
    return destination;
  }

  function goToSignup() {
    var destination = signupDestination();
    var currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
    var signupPath = destination.pathname.replace(/\/+$/, "") || "/";
    if (currentPath === signupPath && scrollToSignupForm()) return;
    window.location.assign(destination.toString());
  }

  function removeReopenButton() {
    var existing = document.getElementById("inrcy-visio-reopen");
    if (existing) existing.remove();
  }

  function showReopenButton() {
    if (hasCompletedBooking) return;
    removeReopenButton();
    var button = document.createElement("button");
    button.id = "inrcy-visio-reopen";
    button.className = "inrcy-visio-reopen";
    button.type = "button";
    button.setAttribute("aria-label", "Réserver ma mise en route iNrCy offerte");
    button.innerHTML = '<span aria-hidden="true">📅</span><strong>Réserver ma mise en route</strong><small>Offerte • 30 à 45 min</small>';
    button.addEventListener("click", function () {
      if (currentToken) {
        openDialog(currentToken, "reopen");
        return;
      }
      goToSignup();
    });
    document.body.appendChild(button);
  }

  function apiPost(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.ok) {
          var error = new Error(payload.error || "Une erreur est survenue.");
          error.code = payload.code || "request_failed";
          throw error;
        }
        return payload;
      });
    });
  }

  function shell(content, options) {
    var opts = options || {};
    return [
      '<div class="inrcy-visio-orbit inrcy-visio-orbit-one"></div>',
      '<div class="inrcy-visio-orbit inrcy-visio-orbit-two"></div>',
      '<button class="inrcy-visio-close" type="button" aria-label="Fermer">×</button>',
      '<div class="inrcy-visio-brand"><img src="' + escapeHtml(config.logoUrl || "") + '" alt=""><span>iNrCy</span></div>',
      '<div class="inrcy-visio-progress" aria-hidden="true">',
      '<span class="' + (opts.step >= 1 ? 'is-active' : '') + '"></span>',
      '<span class="' + (opts.step >= 2 ? 'is-active' : '') + '"></span>',
      '<span class="' + (opts.step >= 3 ? 'is-active' : '') + '"></span>',
      '</div>',
      '<div class="inrcy-visio-content">' + content + '</div>',
    ].join("");
  }

  function setDialog(content, options) {
    if (!dialogRoot) return;
    var dialog = dialogRoot.querySelector(".inrcy-visio-dialog");
    currentStep = Number((options || {}).step || 1);
    dialog.innerHTML = shell(content, options || { step: 1 });
    bindCommonActions();
  }

  function showIntro() {
    setDialog([
      '<div class="inrcy-visio-success-icon" aria-hidden="true">✓</div>',
      '<p class="inrcy-visio-eyebrow">VOTRE ESSAI INRCY EST PRÊT</p>',
      '<h2 id="inrcy-visio-title">Passez à l’action dès demain <span aria-hidden="true">✨</span></h2>',
      '<p class="inrcy-visio-lead">Réservez votre <strong>mise en route personnalisée offerte</strong>. En 30 à 45 minutes, l’équipe iNrCy vous aide à partir sur de bonnes bases.</p>',
      '<div class="inrcy-visio-benefits">',
      '<span><b>30–45 min</b><small>un échange concret et personnalisé</small></span>',
      '<span><b>100 % offert</b><small>mise en route de vos canaux</small></span>',
      '<span><b>Dès demain</b><small>du lundi au samedi</small></span>',
      '</div>',
      '<p class="inrcy-visio-gift"><span aria-hidden="true">🎁</span> Choisissez maintenant l’heure qui vous convient — votre lien Google Meet arrivera par e-mail.</p>',
      '<div class="inrcy-visio-actions">',
      '<button class="inrcy-visio-primary" data-action="choose" type="button"><span>Réserver ma mise en route offerte</span><i aria-hidden="true">→</i></button>',
      '<button class="inrcy-visio-secondary" data-action="skip" type="button">Je choisirai plus tard</button>',
      '</div>',
    ].join(""), { step: 1 });
  }

  function openDialog(token, surface) {
    closeDialog("", true);
    removeReopenButton();
    currentToken = token;
    rememberSessionBookingToken(token);
    bookingSurface = surface || "signup_success";
    bookingSessionId = randomUuid();
    hasCompletedBooking = false;
    selectedStart = "";
    availability = [];
    currentWeekPage = 0;
    previouslyFocused = document.activeElement;
    dialogRoot = document.createElement("div");
    dialogRoot.className = "inrcy-visio-overlay";
    dialogRoot.innerHTML = '<section class="inrcy-visio-dialog" role="dialog" aria-modal="true" aria-labelledby="inrcy-visio-title"></section>';
    document.body.appendChild(dialogRoot);
    document.documentElement.classList.add("inrcy-visio-open");
    showIntro();
    trackFunnel("modal_viewed", 1);
    window.setTimeout(function () {
      var first = dialogRoot && dialogRoot.querySelector("[data-action='choose']");
      if (first) first.focus();
    }, 30);
  }

  function closeDialog(reason, silent) {
    if (!dialogRoot) return;
    if (!silent && !hasCompletedBooking) {
      trackFunnel(reason === "skip" ? "modal_skipped" : "modal_closed", currentStep);
    }
    dialogRoot.remove();
    dialogRoot = null;
    document.documentElement.classList.remove("inrcy-visio-open");
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
    if (!silent && !hasCompletedBooking) showReopenButton();
  }

  function loadingView() {
    setDialog([
      '<div class="inrcy-visio-loader" aria-hidden="true"><span></span><span></span><span></span></div>',
      '<p class="inrcy-visio-eyebrow">AGENDA iNrCy</p>',
      '<h2 id="inrcy-visio-title">Préparation de vos créneaux…</h2>',
      '<p class="inrcy-visio-lead">Tous les horaires de 9 h à 18 h vous sont proposés, du lundi au samedi.</p>',
    ].join(""), { step: 2 });
  }

  function showAvailability() {
    if (!availability.length) {
      setDialog([
        '<p class="inrcy-visio-eyebrow">AGENDA iNrCy</p>',
        '<h2 id="inrcy-visio-title">Aucun créneau en ligne pour le moment</h2>',
        '<p class="inrcy-visio-lead">Votre inscription est bien enregistrée. Notre équipe pourra toujours vous contacter par téléphone.</p>',
        '<div class="inrcy-visio-actions"><button class="inrcy-visio-primary" data-action="skip" type="button">Continuer</button></div>',
      ].join(""), { step: 2 });
      return;
    }

    setDialog([
      '<p class="inrcy-visio-eyebrow">CHOISISSEZ VOTRE CRÉNEAU</p>',
      '<h2 id="inrcy-visio-title">Quand souhaitez-vous échanger&nbsp;?</h2>',
      '<p class="inrcy-visio-lead inrcy-visio-lead-compact">Prévoyez <strong>30 à 45 minutes</strong> pour découvrir iNrCy, échanger sur vos besoins et profiter de la création offerte de vos canaux. Créneaux du lundi au samedi.</p>',
      '<div class="inrcy-visio-week-nav" aria-label="Changer de semaine">',
      '<button class="inrcy-visio-week-arrow" data-action="week-prev" type="button" aria-label="Semaine précédente">‹</button>',
      '<strong class="inrcy-visio-week-label" aria-live="polite"></strong>',
      '<button class="inrcy-visio-week-arrow" data-action="week-next" type="button" aria-label="Semaine suivante">›</button>',
      '</div>',
      '<div class="inrcy-visio-days" role="tablist" aria-label="Jours disponibles"></div>',
      '<div class="inrcy-visio-time-heading"><span>Horaires disponibles</span><small>Heure de Paris</small></div>',
      '<div class="inrcy-visio-times" role="group" aria-label="Horaires disponibles"></div>',
      '<p class="inrcy-visio-selection" aria-live="polite"></p>',
      '<div class="inrcy-visio-actions">',
      '<button class="inrcy-visio-primary" data-action="book" type="button" disabled><span>Confirmer ce rendez-vous</span><i aria-hidden="true">→</i></button>',
      '<button class="inrcy-visio-secondary" data-action="back" type="button">Retour</button>',
      '</div>',
    ].join(""), { step: 2 });
    var previousWeek = dialogRoot.querySelector("[data-action='week-prev']");
    var nextWeek = dialogRoot.querySelector("[data-action='week-next']");
    previousWeek.addEventListener("click", function () { renderWeek(currentWeekPage - 1); });
    nextWeek.addEventListener("click", function () { renderWeek(currentWeekPage + 1); });
    renderWeek(0);
  }

  function renderWeek(pageIndex) {
    if (!dialogRoot || !availability.length) return;
    var totalWeeks = Math.ceil(availability.length / DAYS_PER_PAGE);
    currentWeekPage = Math.max(0, Math.min(pageIndex, totalWeeks - 1));
    var firstDayIndex = currentWeekPage * DAYS_PER_PAGE;
    var visibleDays = availability.slice(firstDayIndex, firstDayIndex + DAYS_PER_PAGE);
    var days = dialogRoot.querySelector(".inrcy-visio-days");
    var label = dialogRoot.querySelector(".inrcy-visio-week-label");
    var previousWeek = dialogRoot.querySelector("[data-action='week-prev']");
    var nextWeek = dialogRoot.querySelector("[data-action='week-next']");

    label.textContent = "Créneaux " + (currentWeekPage + 1) + " / " + totalWeeks;
    previousWeek.disabled = currentWeekPage === 0;
    nextWeek.disabled = currentWeekPage === totalWeeks - 1;
    days.innerHTML = visibleDays.map(function (day, index) {
      var absoluteIndex = firstDayIndex + index;
      var date = new Date(day.slots[0].start);
      var shortWeekday = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "Europe/Paris" }).format(date).replace(".", "");
      var dayNumber = new Intl.DateTimeFormat("fr-FR", { day: "numeric", timeZone: "Europe/Paris" }).format(date);
      var month = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "Europe/Paris" }).format(date).replace(".", "");
      return '<button type="button" role="tab" aria-selected="' + (index === 0 ? 'true' : 'false') + '" class="inrcy-visio-day ' + (index === 0 ? 'is-selected' : '') + '" data-day="' + absoluteIndex + '"><small>' + escapeHtml(shortWeekday) + '</small><b>' + escapeHtml(dayNumber) + '</b><span>' + escapeHtml(month) + '</span></button>';
    }).join("");

    days.querySelectorAll(".inrcy-visio-day").forEach(function (button) {
      button.addEventListener("click", function () {
        days.querySelectorAll(".inrcy-visio-day").forEach(function (item) {
          item.classList.remove("is-selected");
          item.setAttribute("aria-selected", "false");
        });
        button.classList.add("is-selected");
        button.setAttribute("aria-selected", "true");
        renderTimes(Number(button.getAttribute("data-day") || 0));
      });
    });
    renderTimes(firstDayIndex);
  }

  function renderTimes(dayIndex) {
    if (!dialogRoot || !availability[dayIndex]) return;
    selectedStart = "";
    var day = availability[dayIndex];
    var times = dialogRoot.querySelector(".inrcy-visio-times");
    var selection = dialogRoot.querySelector(".inrcy-visio-selection");
    var submit = dialogRoot.querySelector("[data-action='book']");
    selection.textContent = "";
    submit.disabled = true;
    times.innerHTML = day.slots.map(function (slot) {
      return '<button type="button" class="inrcy-visio-time" data-start="' + escapeHtml(slot.start) + '"><span aria-hidden="true">◷</span>' + escapeHtml(slot.label) + '</button>';
    }).join("");
    times.querySelectorAll(".inrcy-visio-time").forEach(function (button) {
      button.addEventListener("click", function () {
        times.querySelectorAll(".inrcy-visio-time").forEach(function (item) { item.classList.remove("is-selected"); });
        button.classList.add("is-selected");
        selectedStart = button.getAttribute("data-start") || "";
        selection.textContent = day.label + " à " + button.textContent.trim();
        submit.disabled = !selectedStart;
        trackFunnel("slot_selected", 2, { slotStart: selectedStart });
      });
    });
  }

  function loadAvailability() {
    trackFunnel("booking_started", 2);
    loadingView();
    apiPost(config.availabilityUrl, { token: currentToken })
      .then(function (payload) {
        availability = Array.isArray(payload.days) ? payload.days : [];
        trackFunnel("availability_loaded", 2, { availabilityDays: availability.length });
        showAvailability();
      })
      .catch(function (error) {
        if (error && (error.code === "visio_booking_token_expired" || error.code === "visio_booking_token_invalid")) {
          forgetSessionBookingToken();
        }
        trackFunnel("availability_failed", 2, { errorCode: error && error.code });
        showError(error);
      });
  }

  function bookSelected() {
    if (!selectedStart || !dialogRoot) return;
    var button = dialogRoot.querySelector("[data-action='book']");
    button.disabled = true;
    button.classList.add("is-loading");
    button.querySelector("span").textContent = "Réservation en cours…";
    trackFunnel("booking_submitted", 2, { slotStart: selectedStart });
    apiPost(config.bookingUrl, { token: currentToken, start: selectedStart })
      .then(function (payload) {
        trackFunnel("booking_completed", 3, { slotStart: selectedStart });
        showConfirmation(payload.booking || {});
      })
      .catch(function (error) {
        if (error && (error.code === "visio_booking_token_expired" || error.code === "visio_booking_token_invalid")) {
          forgetSessionBookingToken();
        }
        trackFunnel("booking_failed", 2, {
          errorCode: error && error.code,
          slotStart: selectedStart,
        });
        if (error && error.code === "visio_slot_unavailable") {
          selectedStart = "";
          loadAvailability();
          return;
        }
        showError(error);
      });
  }

  function showConfirmation(booking) {
    hasCompletedBooking = true;
    rememberCompletedBooking();
    removeReopenButton();
    var meetButton = booking.meetUrl
      ? '<a class="inrcy-visio-primary" href="' + escapeHtml(booking.meetUrl) + '" target="_blank" rel="noopener"><span>Ouvrir Google Meet</span><i aria-hidden="true">↗</i></a>'
      : '';
    setDialog([
      '<div class="inrcy-visio-success-icon inrcy-visio-success-icon-final" aria-hidden="true">✓</div>',
      '<p class="inrcy-visio-eyebrow">RENDEZ-VOUS CONFIRMÉ</p>',
      '<h2 id="inrcy-visio-title">C’est réservé&nbsp;!</h2>',
      '<div class="inrcy-visio-confirm-card">',
      '<span aria-hidden="true">📅</span><div><b>' + escapeHtml(booking.dateLabel || '') + '</b><strong>' + escapeHtml(booking.timeLabel || '') + ' – 30 à 45 minutes</strong></div>',
      '</div>',
      '<p class="inrcy-visio-lead inrcy-visio-lead-compact">Votre rendez-vous aura lieu avec <strong>un membre de l’équipe iNrCy</strong>. L’invitation Google Agenda et le lien Meet vous sont envoyés par e-mail.</p>',
      '<div class="inrcy-visio-preparation">',
      '<span class="inrcy-visio-preparation-icon" aria-hidden="true">💻</span>',
      '<div><b>Bien préparer votre rendez-vous</b><p>Installez-vous de préférence sur un ordinateur et gardez à portée de main les identifiants de vos canaux existants (site, Google, Facebook, Instagram, LinkedIn…).</p><small>Vous saisirez vous-même vos accès : ne nous communiquez jamais vos mots de passe.</small></div>',
      '</div>',
      '<div class="inrcy-visio-actions">' + meetButton + '<button class="inrcy-visio-secondary" data-action="finish" type="button">Terminer</button></div>',
    ].join(""), { step: 3 });
  }

  function showError(error) {
    setDialog([
      '<p class="inrcy-visio-eyebrow">INSCRIPTION BIEN ENREGISTRÉE</p>',
      '<h2 id="inrcy-visio-title">La réservation est momentanément indisponible</h2>',
      '<p class="inrcy-visio-lead">' + escapeHtml(error && error.message ? error.message : 'Vous pourrez réessayer plus tard. Notre équipe peut aussi vous contacter directement.') + '</p>',
      '<div class="inrcy-visio-actions">',
      '<button class="inrcy-visio-primary" data-action="retry" type="button">Réessayer</button>',
      '<button class="inrcy-visio-secondary" data-action="skip" type="button">Continuer sans rendez-vous</button>',
      '</div>',
    ].join(""), { step: 2 });
  }

  function bindCommonActions() {
    if (!dialogRoot) return;
    var close = dialogRoot.querySelector(".inrcy-visio-close");
    if (close) close.addEventListener("click", function () { closeDialog("close"); });
    dialogRoot.querySelectorAll("[data-action='skip']").forEach(function (button) {
      button.addEventListener("click", function () { closeDialog("skip"); });
    });
    dialogRoot.querySelectorAll("[data-action='finish']").forEach(function (button) {
      button.addEventListener("click", function () { closeDialog("finish"); });
    });
    var choose = dialogRoot.querySelector("[data-action='choose']");
    if (choose) choose.addEventListener("click", loadAvailability);
    var back = dialogRoot.querySelector("[data-action='back']");
    if (back) back.addEventListener("click", showIntro);
    var retry = dialogRoot.querySelector("[data-action='retry']");
    if (retry) retry.addEventListener("click", loadAvailability);
    var book = dialogRoot.querySelector("[data-action='book']");
    if (book) book.addEventListener("click", bookSelected);
  }

  document.addEventListener("keydown", function (event) {
    if (!dialogRoot) return;
    if (event.key === "Escape") {
      closeDialog("close");
      return;
    }
    if (event.key !== "Tab") return;
    var focusable = dialogRoot.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if ($) {
    $(document).on("submit_success.inrcyVisioBooking", function (event, response) {
      var token = findBookingToken(response, 0);
      if (!token) return;
      window.setTimeout(function () { openDialog(token, "signup_success"); }, 180);
    });
  }

  function openBookingLinkFromHash() {
    if (!window.location.hash) return;
    var parameters = new URLSearchParams(window.location.hash.slice(1));
    var token = parameters.get("inrcy-booking") || "";
    if (!token) return;
    window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
    window.setTimeout(function () { openDialog(token, "email_link"); }, 80);
  }

  hasCompletedBooking = bookingWasRecentlyCompleted();
  if (!hasCompletedBooking) {
    currentToken = readSessionBookingToken();
    showReopenButton();
  }
  if (window.location.hash === "#inrcy-inscription") {
    window.setTimeout(scrollToSignupForm, 120);
  }
  openBookingLinkFromHash();
})(window.jQuery);
