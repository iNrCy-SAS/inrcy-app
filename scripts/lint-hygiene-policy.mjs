export const hygieneRules = ["@typescript-eslint/no-unused-vars", "react-hooks/exhaustive-deps"];
const identity = (message) => JSON.stringify([message.file, message.rule,
  // exhaustive-deps embeds the dependent hook's location in some messages.
  message.rule === "react-hooks/exhaustive-deps"
    ? message.message.replace(/\(at line \d+\)/g, "(at line <location>)")
    : message.message,
]);

/** Line changes do not hide/add debt; file, rule, message and occurrence count do. */
export function compareHygieneWarnings(messages, baseline) {
  const allowance = new Map();
  for (const entry of baseline.entries) {
    if (!hygieneRules.includes(entry.rule) || !Number.isSafeInteger(entry.count) || entry.count < 1) {
      throw new Error("Invalid lint hygiene baseline entry");
    }
    const key = identity(entry);
    if (allowance.has(key)) throw new Error("Duplicate lint hygiene baseline entry");
    allowance.set(key, entry.count);
  }
  const newWarnings = [];
  const errors = [];
  let knownWarnings = 0;
  for (const message of messages) {
    if (message.severity === 2) { errors.push(message); continue; }
    if (!hygieneRules.includes(message.rule)) continue;
    const key = identity(message);
    const remaining = allowance.get(key) || 0;
    if (remaining > 0) {
      allowance.set(key, remaining - 1);
      knownWarnings++;
    } else {
      newWarnings.push(message);
    }
  }
  return { knownWarnings, newWarnings, errors };
}
