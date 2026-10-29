export class DiscardedReviewPageError extends Error {
  constructor() { super("Review page no longer belongs to the current view"); }
}

/** Shares foreground/background reads and discards results after refresh or account changes. */
export class ReviewPageCache<T> {
  private scope: string | null = null;
  private version = 0;
  private pages = new Map<string, Promise<T>>();

  get revision() { return this.version; }
  isCurrent(scope: string, revision: number) { return this.scope === scope && this.version === revision; }

  clear() {
    this.version += 1;
    this.scope = null;
    this.pages.clear();
  }

  load(scope: string, token: string, read: () => Promise<T>): Promise<T> {
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
    const existing = this.pages.get(token);
    if (existing) return existing;
    const revision = this.version;
    const pending: Promise<T> = Promise.resolve().then(read).then(value => {
      if (!this.isCurrent(scope, revision)) throw new DiscardedReviewPageError();
      return value;
    }).catch(error => {
      if (this.pages.get(token) === pending) this.pages.delete(token);
      throw error;
    });
    this.pages.set(token, pending);
    return pending;
  }
}
