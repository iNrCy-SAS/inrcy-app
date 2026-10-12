import assert from "node:assert/strict";
import test from "node:test";
import { isConfiguredSiteWebWidgetDomain } from "../../lib/widgets/siteWebDomains.ts";

test("the primary FV domain and its explicit secondary domain both authorize installed widgets", () => {
  const site = { url: "https://couvreur-hazebrouck.fr", widget_domains: ["fv-couverture.fr"] };
  assert.equal(isConfiguredSiteWebWidgetDomain(site, "www.couvreur-hazebrouck.fr"), true);
  assert.equal(isConfiguredSiteWebWidgetDomain(site, "https://www.fv-couverture.fr/actualites"), true);
  assert.equal(isConfiguredSiteWebWidgetDomain(site, "another-customer.fr"), false);
});

test("an old registry domain cannot grant access after a URL replacement or disconnection", () => {
  assert.equal(isConfiguredSiteWebWidgetDomain({ url: "https://new-domain.fr" }, "old-domain.fr"), false);
  assert.equal(isConfiguredSiteWebWidgetDomain({ url: "", widget_domains: ["old-domain.fr"] }, "old-domain.fr"), false);
  assert.equal(isConfiguredSiteWebWidgetDomain(null, "old-domain.fr"), false);
  assert.equal(isConfiguredSiteWebWidgetDomain({ url: "https://new-domain.fr", widget_domains: ["old-domain.fr"] }, "old-domain.fr"), true);
});
