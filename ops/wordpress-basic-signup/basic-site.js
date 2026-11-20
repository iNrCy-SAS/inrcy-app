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
  var header = button.closest(".inrcy-header");
  var fixedHeader = header.closest("header");
  var toolsToggle = navigation.querySelector(".inrcy-submenu-toggle");
  var toolsGroup = toolsToggle.parentElement;
  var languages = header.querySelectorAll(".basic-site-language");
  var spacer = fixedHeader.nextElementSibling;
  function updateHeaderSpace() { spacer.style.height = Math.ceil(fixedHeader.getBoundingClientRect().height) + "px"; }
  updateHeaderSpace();
  if (window.ResizeObserver) new ResizeObserver(updateHeaderSpace).observe(fixedHeader);
  else window.addEventListener("resize", updateHeaderSpace);
  function setTools(open) {
    toolsGroup.classList.toggle("is-open", open);
    toolsToggle.setAttribute("aria-expanded", String(open));
  }
  function closeMenu(restoreFocus) {
    button.setAttribute("aria-expanded", "false");
    header.classList.remove("mobile-open");
    setTools(false);
    if (restoreFocus) button.focus();
  }
  button.addEventListener("click", function () {
    var open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    header.classList.toggle("mobile-open", open);
    if (!open) setTools(false);
    languages.forEach(function (language) { language.open = false; });
  });
  toolsToggle.addEventListener("click", function () { setTools(toolsToggle.getAttribute("aria-expanded") !== "true"); });
  document.addEventListener("click", function (event) {
    if (!header.contains(event.target)) closeMenu(false);
    if (!toolsGroup.contains(event.target)) setTools(false);
    languages.forEach(function (language) { if (!language.contains(event.target)) language.open = false; });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    var language = header.querySelector(".basic-site-language[open]");
    if (language) { language.open = false; language.querySelector("summary").focus(); return; }
    if (toolsToggle.getAttribute("aria-expanded") === "true") { setTools(false); toolsToggle.focus(); return; }
    if (button.getAttribute("aria-expanded") === "true") closeMenu(true);
  });
  navigation.querySelectorAll("a").forEach(function (link) { link.addEventListener("click", function () { closeMenu(false); }); });
  var desktop = window.matchMedia("(min-width: 1101px)");
  desktop.addEventListener("change", function () { closeMenu(false); });
  var shortcut = document.querySelector(".inrcy-basic-site .inrcy-float-booksy-wrap");
  var footer = document.querySelector(".inrcy-basic-site .inrcy-footer");
  var hero = document.querySelector("#basic-site-content #inrcyHeroSteps");
  function updateScrollState() {
    fixedHeader.classList.toggle("is-scrolled", window.scrollY > 16);
    if (!shortcut || shortcut.hidden) return;
    var outsideHero = !hero || hero.getBoundingClientRect().bottom < 0;
    var outsideFooter = footer.getBoundingClientRect().top > window.innerHeight;
    var visible = outsideHero && outsideFooter && (desktop.matches || window.scrollY >= 180);
    shortcut.classList.toggle("is-visible", visible);
    shortcut.classList.toggle("is-scroll-ready", visible);
  }
  if (shortcut) shortcut.querySelector("button").addEventListener("click", function () { shortcut.hidden = true; });
  window.addEventListener("scroll", updateScrollState, { passive: true });
  window.addEventListener("resize", updateScrollState);
  updateScrollState();
  var toolbar = document.querySelector("[data-document-toolbar]");
  if (toolbar) {
    toolbar.hidden = false;
    var input = toolbar.querySelector("input");
    var sections = document.querySelectorAll(".basic-document-article");
    var tocLinks = document.querySelectorAll(".basic-document-toc-link");
    var count = toolbar.querySelector('[role="status"]');
    function normalize(value) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
    function filterSections() {
      var term = normalize(input.value.trim()), shown = 0;
      sections.forEach(function (article, index) {
        var visible = normalize(article.textContent).includes(term);
        article.hidden = !visible;
        if (tocLinks[index]) tocLinks[index].hidden = !visible;
        if (visible) shown++;
      });
      count.textContent = shown + (shown === 1 ? " section" : " sections");
    }
    input.addEventListener("input", filterSections);
    filterSections();
  }
})();
