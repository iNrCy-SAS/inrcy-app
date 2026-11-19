(function inrcyBasicSite() {
  "use strict";
  var button = document.querySelector(".basic-site-menu");
  var navigation = document.getElementById("basic-site-navigation");
  if (!button || !navigation) return;
  var links = (window.inrcyBasicSiteConfig || {}).links || {};
  // Keep Complianz's own document, categories, preferences and event handlers.
  // Only the destinations of known general-site document links are adapted.
  var documentPaths = {
    "/": "home", "/nos-packs": "pricing", "/inscription": "signup", "/s-inscrire": "signup", "/contact": "contact",
    "/politique-de-cookies-ue": "cookies", "/politique-de-confidentialite": "privacy", "/cga-conditions-generales-dabonnement": "terms", "/mentions-legales": "legal",
  };
  function confineCookieLinks() {
    document.querySelectorAll(".cmplz-cookiebanner a[href], #cmplz-document a[href], .cmplz-document a[href], #cmplz-manage-consent-container a[href], .cmplz-manage-consent-container a[href], a.cmplz-link").forEach(function (link) {
      try {
        var href = link.getAttribute("href");
        if (!href || href.charAt(0) === "#") return;
        var url = new URL(href, document.baseURI);
        if (url.origin !== window.location.origin && url.origin !== "https://inrcy.com" && url.origin !== "https://www.inrcy.com") return;
        var path = url.pathname.replace(/\/+$/, "") || "/";
        var destination = links[documentPaths[path]];
        if (destination) {
          var target = new URL(destination, document.baseURI);
          url.searchParams.forEach(function (value, key) { if (!target.searchParams.has(key)) target.searchParams.append(key, value); });
          target.hash = url.hash;
          link.setAttribute("href", target.toString());
        }
      } catch {}
    });
  }
  confineCookieLinks();
  new MutationObserver(confineCookieLinks).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  document.documentElement.classList.add("inrcy-basic-site-ready");
  function closeMenu(restoreFocus) {
    button.setAttribute("aria-expanded", "false");
    navigation.removeAttribute("data-open");
    if (restoreFocus) button.focus();
  }
  button.addEventListener("click", function () {
    var open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    if (open) navigation.setAttribute("data-open", "true");
    else navigation.removeAttribute("data-open");
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") closeMenu(true);
  });
  navigation.querySelectorAll("a").forEach(function (link) { link.addEventListener("click", function () { closeMenu(false); }); });
  if (window.matchMedia) window.matchMedia("(min-width: 981px)").addEventListener("change", function (event) { if (event.matches) closeMenu(false); });
})();
