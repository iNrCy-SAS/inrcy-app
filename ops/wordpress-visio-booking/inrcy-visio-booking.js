(function inrcyVisioBooking($) {
  "use strict";

  var config = window.inrcyVisioBookingConfig || {};
  var currentToken = "";
  var dialogRoot = null;
  var previouslyFocused = null;
  var selectedStart = "";
  var availability = [];
  var currentWeekPage = 0;
  var DAYS_PER_WEEK = 7;

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
    dialog.innerHTML = shell(content, options || { step: 1 });
    bindCommonActions();
  }

  function openDialog(token) {
    closeDialog();
    currentToken = token;
    selectedStart = "";
    availability = [];
    currentWeekPage = 0;
    previouslyFocused = document.activeElement;
    dialogRoot = document.createElement("div");
    dialogRoot.className = "inrcy-visio-overlay";
    dialogRoot.innerHTML = '<section class="inrcy-visio-dialog" role="dialog" aria-modal="true" aria-labelledby="inrcy-visio-title"></section>';
    document.body.appendChild(dialogRoot);
    document.documentElement.classList.add("inrcy-visio-open");
    setDialog([
      '<div class="inrcy-visio-success-icon" aria-hidden="true">✓</div>',
      '<p class="inrcy-visio-eyebrow">INSCRIPTION CONFIRMÉE</p>',
      '<h2 id="inrcy-visio-title">Votre inscription est validée&nbsp;! <span aria-hidden="true">🎉</span></h2>',
      '<p class="inrcy-visio-lead">Souhaitez-vous programmer une présentation en visio avec iNrCy et profiter de la <strong>création offerte de vos canaux</strong>&nbsp;?</p>',
      '<div class="inrcy-visio-benefits">',
      '<span><b>60 min</b><small>avec un membre de l’équipe iNrCy</small></span>',
      '<span><b>Google Meet</b><small>lien envoyé par e-mail</small></span>',
      '</div>',
      '<div class="inrcy-visio-actions">',
      '<button class="inrcy-visio-primary" data-action="choose" type="button"><span>Choisir mon créneau</span><i aria-hidden="true">→</i></button>',
      '<button class="inrcy-visio-secondary" data-action="skip" type="button">Non, continuer sans rendez-vous</button>',
      '</div>',
    ].join(""), { step: 1 });
    window.setTimeout(function () {
      var first = dialogRoot && dialogRoot.querySelector("[data-action='choose']");
      if (first) first.focus();
    }, 30);
  }

  function closeDialog() {
    if (!dialogRoot) return;
    dialogRoot.remove();
    dialogRoot = null;
    document.documentElement.classList.remove("inrcy-visio-open");
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  }

  function loadingView() {
    setDialog([
      '<div class="inrcy-visio-loader" aria-hidden="true"><span></span><span></span><span></span></div>',
      '<p class="inrcy-visio-eyebrow">AGENDA iNrCy</p>',
      '<h2 id="inrcy-visio-title">Recherche des meilleurs créneaux…</h2>',
      '<p class="inrcy-visio-lead">Nous vérifions les disponibilités de l’équipe en temps réel.</p>',
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
      '<p class="inrcy-visio-lead inrcy-visio-lead-compact">Prévoyez environ une heure pour découvrir iNrCy, échanger sur vos besoins et profiter de la <strong>création offerte de vos canaux</strong>.</p>',
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
    var totalWeeks = Math.ceil(availability.length / DAYS_PER_WEEK);
    currentWeekPage = Math.max(0, Math.min(pageIndex, totalWeeks - 1));
    var firstDayIndex = currentWeekPage * DAYS_PER_WEEK;
    var visibleDays = availability.slice(firstDayIndex, firstDayIndex + DAYS_PER_WEEK);
    var days = dialogRoot.querySelector(".inrcy-visio-days");
    var label = dialogRoot.querySelector(".inrcy-visio-week-label");
    var previousWeek = dialogRoot.querySelector("[data-action='week-prev']");
    var nextWeek = dialogRoot.querySelector("[data-action='week-next']");

    label.textContent = "Semaine " + (currentWeekPage + 1) + " / " + totalWeeks;
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
      });
    });
  }

  function loadAvailability() {
    loadingView();
    apiPost(config.availabilityUrl, { token: currentToken })
      .then(function (payload) {
        availability = Array.isArray(payload.days) ? payload.days : [];
        showAvailability();
      })
      .catch(showError);
  }

  function bookSelected() {
    if (!selectedStart || !dialogRoot) return;
    var button = dialogRoot.querySelector("[data-action='book']");
    button.disabled = true;
    button.classList.add("is-loading");
    button.querySelector("span").textContent = "Réservation en cours…";
    apiPost(config.bookingUrl, { token: currentToken, start: selectedStart })
      .then(function (payload) { showConfirmation(payload.booking || {}); })
      .catch(function (error) {
        if (error && error.code === "visio_slot_unavailable") {
          selectedStart = "";
          loadAvailability();
          return;
        }
        showError(error);
      });
  }

  function showConfirmation(booking) {
    var meetButton = booking.meetUrl
      ? '<a class="inrcy-visio-primary" href="' + escapeHtml(booking.meetUrl) + '" target="_blank" rel="noopener"><span>Ouvrir Google Meet</span><i aria-hidden="true">↗</i></a>'
      : '';
    setDialog([
      '<div class="inrcy-visio-success-icon inrcy-visio-success-icon-final" aria-hidden="true">✓</div>',
      '<p class="inrcy-visio-eyebrow">RENDEZ-VOUS CONFIRMÉ</p>',
      '<h2 id="inrcy-visio-title">C’est réservé&nbsp;!</h2>',
      '<div class="inrcy-visio-confirm-card">',
      '<span aria-hidden="true">📅</span><div><b>' + escapeHtml(booking.dateLabel || '') + '</b><strong>' + escapeHtml(booking.timeLabel || '') + ' – 1 heure</strong></div>',
      '</div>',
      '<p class="inrcy-visio-lead inrcy-visio-lead-compact">Votre rendez-vous aura lieu avec <strong>un membre de l’équipe iNrCy</strong>. L’invitation Google Agenda et le lien Meet vous sont envoyés par e-mail.</p>',
      '<div class="inrcy-visio-actions">' + meetButton + '<button class="inrcy-visio-secondary" data-action="skip" type="button">Terminer</button></div>',
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
    if (close) close.addEventListener("click", closeDialog);
    dialogRoot.querySelectorAll("[data-action='skip']").forEach(function (button) { button.addEventListener("click", closeDialog); });
    var choose = dialogRoot.querySelector("[data-action='choose']");
    if (choose) choose.addEventListener("click", loadAvailability);
    var back = dialogRoot.querySelector("[data-action='back']");
    if (back) back.addEventListener("click", function () { openDialog(currentToken); });
    var retry = dialogRoot.querySelector("[data-action='retry']");
    if (retry) retry.addEventListener("click", loadAvailability);
    var book = dialogRoot.querySelector("[data-action='book']");
    if (book) book.addEventListener("click", bookSelected);
  }

  document.addEventListener("keydown", function (event) {
    if (!dialogRoot) return;
    if (event.key === "Escape") {
      closeDialog();
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
      window.setTimeout(function () { openDialog(token); }, 180);
    });
  }
})(window.jQuery);
