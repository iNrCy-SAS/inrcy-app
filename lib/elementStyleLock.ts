type StyleLock = {
  originalValue: string;
  originalPriority: string;
  value: string;
  owners: Set<symbol>;
};

const elementLocks = new WeakMap<HTMLElement, Map<string, StyleLock>>();

/** Share matching inline style locks without depending on overlay close order. */
export function acquireElementStyleLock(element: HTMLElement, declarations: Readonly<Record<string, string>>): () => void {
  const locks = elementLocks.get(element) ?? new Map<string, StyleLock>();
  elementLocks.set(element, locks);
  const owner = Symbol();
  const acquired: Array<[string, StyleLock]> = [];
  for (const [property, value] of Object.entries(declarations)) {
    let lock = locks.get(property);
    if (!lock) {
      lock = {
        originalValue: element.style.getPropertyValue(property),
        originalPriority: element.style.getPropertyPriority(property),
        value,
        owners: new Set(),
      };
      locks.set(property, lock);
      element.style.setProperty(property, value);
    }
    lock.owners.add(owner);
    acquired.push([property, lock]);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const [property, lock] of acquired) {
      lock.owners.delete(owner);
      if (lock.owners.size) continue;
      // Another feature may have deliberately changed this declaration while open.
      if (element.style.getPropertyValue(property) === lock.value && element.style.getPropertyPriority(property) === "") {
        if (lock.originalValue) element.style.setProperty(property, lock.originalValue, lock.originalPriority);
        else element.style.removeProperty(property);
      }
      locks.delete(property);
    }
    if (!locks.size) elementLocks.delete(element);
  };
}
