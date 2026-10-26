import assert from "node:assert/strict";
import test from "node:test";
import { dashboardAssistantErrorCopy } from "../../app/dashboard/_components/dashboardAssistantErrorCopy.ts";

test("unknown API/provider errors never become customer-facing text", () => {
  const generic = dashboardAssistantErrorCopy("fr");
  for (const code of [undefined, null, { error: "PRIVATE credentials" }, "648524ab-0844-405e-9b86-1c168e1ec717", "TypeError: PRIVATE STACK", "provider_internal_failure"]) {
    assert.equal(dashboardAssistantErrorCopy("fr", code, 503), generic);
  }
  assert.match(generic, /Votre demande est conservée/);
});

test("known actionable problems get distinct human explanations without diagnostic codes", () => {
  assert.match(dashboardAssistantErrorCopy("fr", "assistant_memory_unavailable"), /notre échange/);
  assert.match(dashboardAssistantErrorCopy("fr", "ai_gateway_account_limit_reached"), /limite d’utilisation/);
  assert.match(dashboardAssistantErrorCopy("fr", undefined, 401), /Reconnectez-vous/);
  assert.match(dashboardAssistantErrorCopy("fr", "assistant_invalid_request"), /reformuler/);
  assert.match(dashboardAssistantErrorCopy("fr", "assistant_client_timeout"), /même travail/);
  assert.match(dashboardAssistantErrorCopy("fr", "assistant_memory_conflict"), /nouvelle conversation/);
});

test("all supported locales have customer error copy and preserve the locale fallback", () => {
  for (const locale of ["fr-FR", "en-GB", "es", "it", "de", "nl", "pt", "th", "zh"]) {
    for (const code of [undefined, "assistant_memory_unavailable", "ai_gateway_account_limit_reached", "auth_required", "assistant_invalid_request", "assistant_memory_conflict", "assistant_client_timeout"]) {
      const text = dashboardAssistantErrorCopy(locale, code);
      assert.ok(text.length > 12 && text.length < 300);
      assert.doesNotMatch(text, /assistant_|ai_gateway_|UUID|stack|HTTP|503|648524ab/);
    }
  }
  assert.equal(dashboardAssistantErrorCopy("unknown"), dashboardAssistantErrorCopy("fr"));
});
