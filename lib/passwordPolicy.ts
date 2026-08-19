export const PASSWORD_MIN_LENGTH = 8;

export function evaluatePassword(password: string) {
  const rules = {
    minLen: password.length >= PASSWORD_MIN_LENGTH,
    hasLetter: /\p{L}/u.test(password),
    hasNumber: /\p{N}/u.test(password),
    hasUpper: /\p{Lu}/u.test(password),
    hasSymbol: /[^\p{L}\p{N}]/u.test(password),
  };
  const score = Object.values(rules).filter(Boolean).length;
  const isStrong = score === Object.keys(rules).length;

  return {
    rules,
    score,
    percent: (score / Object.keys(rules).length) * 100,
    isStrong,
    // There is intentionally no word denylist here. A password is accepted
    // as soon as it satisfies the five criteria displayed to the user.
    isAcceptable: isStrong,
  };
}
