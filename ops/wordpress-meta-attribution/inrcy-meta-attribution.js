/*
 * iNrCy - attribution publicitaire first-party + déduplication Pixel/CAPI.
 * À charger sur tout inrcy.com après Complianz et Elementor.
 * Ne contient aucun secret.
 */
(function inrcyMetaAttribution() {
  "use strict";

  if (window.__inrcyMetaAttributionInitialized) return;
  window.__inrcyMetaAttributionInitialized = true;

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
  var SESSION_STORAGE_KEY = "inrcy_signup_attribution_v1";
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

  function readStoredAttribution() {
    try {
      var parsed = JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      if (!parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values)) {
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function storeAttribution(attribution) {
    try {
      window.sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          values: attribution.values,
          capturedAt: attribution.capturedAt,
          landingPageUrl: attribution.landingPageUrl,
        }),
      );
    } catch (_) {
      // Le suivi doit rester non bloquant si le stockage navigateur est indisponible.
    }
  }

  function currentAttribution() {
    var params = new URLSearchParams(window.location.search);
    var currentValues = {};
    ATTRIBUTION_KEYS.forEach(function (key) {
      var value = String(params.get(key) || "").trim();
      if (value) currentValues[key] = value;
    });

    var hasCurrentAttribution = ATTRIBUTION_KEYS.some(function (key) {
      return Boolean(currentValues[key]);
    });
    var stored = readStoredAttribution();
    var values = Object.assign({}, stored ? stored.values : {}, currentValues);
    var hasCampaignData = ATTRIBUTION_KEYS.some(function (key) {
      return key !== "fbclid" && Boolean(values[key]);
    });
    var capturedAt = String(params.get("attribution_captured_at") || "").trim();
    var landingPageUrl = String(params.get("landing_page_url") || "").trim();

    if (!capturedAt && hasCurrentAttribution) {
      capturedAt = new Date().toISOString();
    } else if (!capturedAt && stored) {
      capturedAt = String(stored.capturedAt || "").trim();
    }
    if (!landingPageUrl && hasCurrentAttribution) {
      landingPageUrl = safeUrl(window.location.href);
    } else if (!landingPageUrl && stored) {
      landingPageUrl = String(stored.landingPageUrl || "").trim();
    }

    var attribution = {
      values: values,
      hasAttribution: hasCampaignData || Boolean(values.fbclid),
      capturedAt: capturedAt,
      landingPageUrl: safeUrl(landingPageUrl),
    };
    if (hasCurrentAttribution) storeAttribution(attribution);
    return attribution;
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
    var normalizedValue = String(value || "");
    input.value = normalizedValue;
    input.defaultValue = normalizedValue;
    input.setAttribute("value", normalizedValue);
    return input;
  }

  function copyAttributionToFormData(form, formData) {
    Array.prototype.forEach.call(
      form.querySelectorAll('input[data-inrcy-attribution="1"]'),
      function (input) {
        formData.set(input.name, input.value);
      },
    );
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

    if (form.getAttribute("data-inrcy-attribution-bound") !== "1") {
      form.setAttribute("data-inrcy-attribution-bound", "1");
      form.addEventListener("formdata", function (event) {
        prepareForm(form);
        copyAttributionToFormData(form, event.formData);
      });
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
      // Neutralise l'ancien déclencheur Lead sans toucher au Pixel/PageView.
      window.jQuery(document).off("submit_success.inrcyMeta");
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
