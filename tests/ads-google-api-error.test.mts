import assert from "node:assert/strict";
import test from "node:test";
import { GoogleAdsApiError, googleAdsApiErrorMessage } from "../lib/adsGoogleApiError.ts";

test("le détail Google Ads indique le code et le champ sans divulguer le contenu du déclencheur", () => {
  const message = googleAdsApiErrorMessage({
    error: {
      message: "Request contains an invalid argument.",
      details: [{
        requestId: "abc12345-XYZ",
        errors: [{
          errorCode: { assetLinkError: "UNSUPPORTED_FIELD_TYPE" },
          message: "The given field type is not supported to be added directly through asset links.",
          trigger: { stringValue: "private campaign content" },
          location: { fieldPathElements: [{ fieldName: "mutate_operations", index: 22 }, { fieldName: "campaign_asset_operation" }] },
        }],
      }],
    },
  }, "Erreur Google Ads");

  assert.match(message, /assetLinkError\.UNSUPPORTED_FIELD_TYPE/);
  assert.match(message, /mutate_operations\[22\]\.campaign_asset_operation/);
  assert.match(message, /abc12345-XYZ/);
  assert.doesNotMatch(message, /private campaign content/);
});

test("le repli Google Ads et le statut HTTP restent exploitables", () => {
  assert.equal(googleAdsApiErrorMessage({ error: { message: "Bad request" } }, "fallback"), "Bad request");
  const error = new GoogleAdsApiError("Bad request", 400);
  assert.equal(error.status, 400);
  assert.equal(error.name, "GoogleAdsApiError");
});
