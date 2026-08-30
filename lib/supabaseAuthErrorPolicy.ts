type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function isExistingAuthUserError(error: unknown) {
  const candidate = (error || {}) as AuthErrorLike;
  const code = String(candidate.code || "").trim().toLowerCase();
  const message = String(candidate.message || error || "").trim().toLowerCase();
  return (
    ["user_already_exists", "email_exists"].includes(code) ||
    /\b(?:user|email(?: address)?) (?:is |has )?already (?:been )?(?:registered|exists)\b/.test(message) ||
    /\balready (?:been )?registered (?:a )?(?:user|email(?: address)?)\b/.test(message) ||
    message.includes("a user with this email address has already been registered") ||
    message.includes("email_exists")
  );
}
