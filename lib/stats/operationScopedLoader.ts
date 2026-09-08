export type AsyncLoader<T> = () => Promise<T>;

/**
 * Shares one async load inside an explicitly created server operation.
 * The returned closure owns the promise, so nothing survives the request/bulk
 * operation that created it and no cross-user cache can be introduced.
 */
export function createOperationScopedLoader<T>(load: AsyncLoader<T>): AsyncLoader<T> {
  let result: Promise<T> | null = null;

  return () => {
    result ??= Promise.resolve().then(load);
    return result;
  };
}
