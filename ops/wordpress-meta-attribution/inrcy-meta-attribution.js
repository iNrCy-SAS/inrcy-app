/*
 * iNrCy - attribution publicitaire first-party + déduplication Pixel/CAPI.
 * À charger sur tout inrcy.com après Complianz et Elementor.
 * Ne contient aucun secret.
 */
(function inrcyMetaAttribution() {
  "use strict";

  var ATTRIBUTION_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "placement",
    "site_source_name",
    "fbclid",
  ];
  var SIGNUP_PATH = /\/(?:inscription|s-inscrire|signup|register)(?:\/|$)/i;
  var lastSubmittedForm = null;
  var refreshTimer = null;

  function safeUrl(value) {
    try {
      var url = new URL(value, window.location.origin);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      url.hash = "";
      ["fbclid", "gclid", "msclkid", "_fbc", "_fbp", "event_id"].forEach(function (key) {
        url.searchParams.delete(key);
      });
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function readCookie(name) {
    var prefix = encodeURIComponent(name) + "=";
    var parts = String(document.cookie || "").split(";");
    for (var index = 0; index < parts.length; index += 1) {
      var part = parts[index].trim();
      if (part.indexOf(prefix) === 0) {
        try {
          return decodeURIComponent(part.slice(prefix.length));
        } catch (_) {
          return part.slice(prefix.length);
        }
      }
    }
    return "";
  }

  function marketingConsentGranted() {
    try {
      if (typeof window.cmplz_has_consent === "function") {
        return window.cmplz_has_consent("marketing") === true;
      }
    } catch (_) {
      // Le cookie Complianz reste le repli canonique.
    }
    return ["allow", "accepted", "1", "true", "yes"].indexOf(
      readCookie("cmplz_marketing").toLowerCase(),
    ) !== -1;
  }

  function newEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return "inrcy-lead-" + window.crypto.randomUUID();
    }
    return "inrcy-lead-" + Date.now() + "-" + Math.random().toString(36).slice(2, 14);
  }

  function currentAttribution() {
    var params = new URLSearchParams(window.location.search);
    var values = {};
    ATTRIBUTION_KEYS.forEach(function (key) {
      var value = String(params.get(key) || "").trim();
      if (value) values[key] = value;
    });

    var hasCampaignData = ATTRIBUTION_KEYS.some(function (key) {
      return key !== "fbclid" && Boolean(values[key]);
    });
    var capturedAt = String(params.get("attribution_captured_at") || "").trim();
    var landingPageUrl = String(params.get("landing_page_url") || "").trim();

    if ((hasCampaignData || values.fbclid) && !capturedAt) {
      capturedAt = new Date().toISOString();
    }
    if ((hasCampaignData || values.fbclid) && !landingPageUrl) {
      landingPageUrl = safeUrl(window.location.href);
    }

    return {
      values: values,
      hasAttribution: hasCampaignData || Boolean(values.fbclid),
      capturedAt: capturedAt,
      landingPageUrl: safeUrl(landingPageUrl),
    };
  }

  function decorateSignupLinks() {
    var attribution = currentAttribution();
    if (!attribution.hasAttribution) return;

    document.querySelectorAll("a[href]").forEach(function (anchor) {
      var target;
      try {
        target = new URL(anchor.getAttribute("href"), window.location.origin);
      } catch (_) {
        return;
      }
      if (target.origin !== window.location.origin || !SIGNUP_PATH.test(target.pathname)) return;

      ATTRIBUTION_KEYS.forEach(function (key) {
        if (attribution.values[key]) target.searchParams.set(key, attribution.values[key]);
      });
      if (attribution.capturedAt) {
        target.searchParams.set("attribution_captured_at", attribution.capturedAt);
      }
      if (attribution.landingPageUrl) {
        target.searchParams.set("landing_page_url", attribution.landingPageUrl);
      }
      anchor.setAttribute("href", target.toString());
    });
  }

  function findInput(form, name) {
    return Array.prototype.find.call(form.elements || [], function (element) {
      return element && element.name === name;
    }) || null;
  }

  function upsertHidden(form, fieldId, value) {
    var name = "form_fields[" + fieldId + "]";
    var input = findInput(form, name);
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.setAttribute("data-inrcy-attribution", "1");
      form.appendChild(input);
    }
    input.value = String(value || "");
    return input;
  }

  function isSignupForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    if (SIGNUP_PATH.test(window.location.pathname)) return true;
    return Boolean(
      findInput(form, "form_fields[email]") &&
      (findInput(form, "form_fields[company_name]") || findInput(form, "form_fields[consent]")),
    );
  }

  function prepareForm(form) {
    if (!isSignupForm(form)) return;
    var attribution = currentAttribution();
    var consent = marketingConsentGranted();

    Object.keys(attribution.values).forEach(function (key) {
      if (key !== "fbclid") upsertHidden(form, key, attribution.values[key]);
    });

    upsertHidden(form, "fbclid", attribution.values.fbclid || "");
    upsertHidden(form, "landing_page_url", attribution.landingPageUrl || safeUrl(window.location.href));
    upsertHidden(form, "event_source_url", safeUrl(window.location.href));
    upsertHidden(form, "referrer_url", safeUrl(document.referrer));
    upsertHidden(form, "attribution_captured_at", attribution.capturedAt || new Date().toISOString());
    upsertHidden(form, "meta_tracking_consent", consent ? "true" : "false");
    upsertHidden(form, "client_user_agent", consent ? navigator.userAgent : "");
    upsertHidden(form, "fbp", consent ? readCookie("_fbp") : "");

    var fbc = consent ? readCookie("_fbc") : "";
    if (consent && !fbc && attribution.values.fbclid) {
      var capturedTime = Date.parse(attribution.capturedAt || "");
      fbc = "fb.1." + (Number.isFinite(capturedTime) ? capturedTime : Date.now()) + "." + attribution.values.fbclid;
    }
    upsertHidden(form, "fbc", fbc);

    var eventIdInput = findInput(form, "form_fields[event_id]");
    if (!eventIdInput || !String(eventIdInput.value || "").trim()) {
      upsertHidden(form, "event_id", newEventId());
    }
  }

  function prepareAllForms() {
    document.querySelectorAll("form.elementor-form, form").forEach(prepareForm);
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(function () {
      refreshTimer = null;
      decorateSignupLinks();
      prepareAllForms();
    }, 80);
  }

  function trackSuccessfulLead(form) {
    if (!form || form.getAttribute("data-inrcy-lead-sent") === "1") return;
    prepareForm(form);
    var eventIdInput = findInput(form, "form_fields[event_id]");
    var eventId = eventIdInput ? String(eventIdInput.value || "").trim() : "";
    if (!eventId || typeof window.fbq !== "function") return;

    window.fbq(
      "track",
      "Lead",
      {
        content_name: "Inscription iNrCy",
        content_category: "Essai gratuit 21 jours",
        currency: "EUR",
        value: 0,
      },
      { eventID: eventId },
    );
    form.setAttribute("data-inrcy-lead-sent", "1");
  }

  function boot() {
    decorateSignupLinks();
    prepareAllForms();

    document.addEventListener(
      "submit",
      function (event) {
        var form = event.target;
        if (!isSignupForm(form)) return;
        prepareForm(form);
        lastSubmittedForm = form;
      },
      true,
    );

    if (window.jQuery) {
      window.jQuery(document).on("submit_success.inrcyMetaAttribution", function (event) {
        var form = isSignupForm(event.target) ? event.target : lastSubmittedForm;
        trackSuccessfulLead(form);
      });
    }

    ["cmplz_status_change", "cmplz_cookie_warning_loaded"].forEach(function (eventName) {
      document.addEventListener(eventName, prepareAllForms);
    });

    var observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
