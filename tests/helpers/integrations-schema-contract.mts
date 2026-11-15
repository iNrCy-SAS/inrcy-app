// Exact public.integrations column names confirmed through the production
// OpenAPI schema on 2026-11-16. Nested metadata may contain provider URL keys;
// an absent SQL column remains invalid even when its submitted value is null.
const columns = new Set([
  "access_token_enc", "account_email", "category", "created_at", "display_name",
  "email_address", "expires_at", "id", "meta", "product", "provider",
  "provider_account_id", "refresh_token_enc", "resource_id", "resource_label",
  "scopes", "settings", "source", "status", "updated_at", "user_id",
]);

export function integrationWriteSchemaError(payload: Record<string, unknown>) {
  const unknown = Object.keys(payload).find(key => !columns.has(key));
  return unknown ? { code: "PGRST204", message: `Could not find the '${unknown}' column of 'integrations' in the schema cache` } : null;
}
