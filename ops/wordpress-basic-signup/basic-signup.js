(function inrcyBasicSignup($) {
  "use strict";
  var config = window.inrcyBasicSignupConfig || {};
  var form = document.querySelector('form[name="inrcy_basic_signup"]');
  if (!form || !$) return;
  var busy = false;
  var completed = false;
  var status = form.querySelector(".inrcy-basic-status");
  var button = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy || completed || button.disabled || !form.reportValidity()) return;
    busy = true;
    button.disabled = true;
    status.textContent = "Création de votre compte en cours…";
    var body = new FormData(form);
    body.set("action", "inrcy_basic_signup");
    body.set("nonce", config.nonce || "");
    fetch(config.ajaxUrl, { method: "POST", body: body, credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok || payload.success !== true || !payload.data || !payload.data.inrcy_signup_access
              || payload.data.direct_signup !== true || payload.data.activation_required !== true
              || payload.data.trial_days !== 0 || payload.data.trial_end_at !== null) {
            throw new Error(payload.data && payload.data.message || "La création du compte n’a pas pu être confirmée. Réessayez plus tard.");
          }
          completed = true;
          status.textContent = "Votre compte est prêt. Retrouvez vos accès dans la fenêtre qui s’ouvre.";
          // The private receipt is passed only to the copied access renderer.
          // The existing Meta handler reads only the form/event ID.
          $(form).trigger("submit_success", [payload.data]);
        });
      })
      .catch(function (error) {
        status.textContent = error && error.message || "La connexion a été interrompue. Vérifiez votre accès avant de réessayer.";
      })
      .finally(function () { busy = false; button.disabled = completed; });
  });
})(window.jQuery);
