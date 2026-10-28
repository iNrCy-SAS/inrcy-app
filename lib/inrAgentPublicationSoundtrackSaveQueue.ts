export type InrAgentPublicationSoundtrackSaveTask = () => void | Promise<unknown>;

export type InrAgentPublicationSoundtrackSaveQueue = {
  /** Only waiting tasks with the same key coalesce. An active request always finishes. */
  enqueue: (task: InrAgentPublicationSoundtrackSaveTask, key?: string) => Promise<void>;
  /** Wait through tasks added during the drain; reject an unrepaired latest save. */
  flush: () => Promise<void>;
  /** Call only after the UI has rolled back to its confirmed saved value. */
  acknowledgeFailure: (key: string) => void;
};

type QueueKey = string | symbol;
type Waiter = { resolve: () => void; reject: (error: unknown) => void };
type PendingSave = { task: InrAgentPublicationSoundtrackSaveTask; version: number; waiters: Waiter[] };

/** Client-only orchestration: no network, timers, React state, or server dependencies. */
export function createInrAgentPublicationSoundtrackSaveQueue(): InrAgentPublicationSoundtrackSaveQueue {
  const pending = new Map<QueueKey, PendingSave>();
  const latestVersions = new Map<QueueKey, number>();
  const failures = new Map<QueueKey, unknown>();
  let version = 0;
  let draining: Promise<void> | null = null;

  const scheduleDrain = () => {
    if (draining) return;
    // The microtask also coalesces rapid choices made before a request starts.
    draining = Promise.resolve().then(async () => {
      while (pending.size) {
        const [key, entry] = pending.entries().next().value!;
        pending.delete(key);
        try {
          await entry.task();
          if (latestVersions.get(key) === entry.version) failures.delete(key);
          entry.waiters.forEach(waiter => waiter.resolve());
        } catch (error) {
          if (latestVersions.get(key) === entry.version) failures.set(key, error);
          entry.waiters.forEach(waiter => waiter.reject(error));
        }
      }
    }).finally(() => {
      draining = null;
      // An enqueue promise's reaction may have added a choice as we became idle.
      if (pending.size) scheduleDrain();
    });
  };

  return {
    enqueue(task, requestedKey) {
      const key = requestedKey ?? Symbol("soundtrack-save");
      const currentVersion = ++version;
      latestVersions.set(key, currentVersion);
      failures.delete(key);
      const completion = new Promise<void>((resolve, reject) => {
        const previous = pending.get(key);
        const waiters = previous?.waiters || [];
        waiters.push({ resolve, reject });
        pending.set(key, { task, version: currentVersion, waiters });
      });
      // UI event handlers may intentionally ignore completion; flush still
      // reports the error, without producing an unhandled rejection meanwhile.
      void completion.catch(() => {});
      scheduleDrain();
      return completion;
    },
    async flush() {
      while (draining || pending.size) {
        if (!draining) scheduleDrain();
        await draining;
      }
      if (failures.size === 1) throw failures.values().next().value;
      if (failures.size > 1) throw new AggregateError([...failures.values()], "soundtrack_save_failed");
    },
    acknowledgeFailure(key) {
      failures.delete(key);
    },
  };
}
