/** Strip pilot-only projections at the response boundary, including stale caches. */
export function withoutThreadsData<T>(value: T, enabled: boolean): T {
  if (enabled || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.filter((item) => item !== "threads" && !(item && typeof item === "object" && ((item as Record<string, unknown>).key === "threads" || (item as Record<string, unknown>).channel === "threads")))
      .map((item) => withoutThreadsData(item, false)) as T;
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^threads(?:$|[A-Z_])/.test(key))
    .map(([key, child]) => [key, withoutThreadsData(child, false)])) as T;
}
