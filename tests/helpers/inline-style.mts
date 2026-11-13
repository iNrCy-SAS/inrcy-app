/** Minimal inline-declaration boundary for isolated effects, not a layout model. */
export function inlineStyle() {
  const values: Record<string, string> = {}, priorities: Record<string, string> = {};
  return {
    getPropertyValue: (property: string) => values[property] ?? "",
    getPropertyPriority: (property: string) => priorities[property] ?? "",
    setProperty(property: string, value: string, priority = "") { values[property] = value; priorities[property] = priority; },
    removeProperty(property: string) { const previous = values[property] ?? ""; delete values[property]; delete priorities[property]; return previous; },
  };
}
