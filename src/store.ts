/**
 * Where the router and the grants remember things. It is asynchronous because the store in a page is a database of
 * smaltai's own, reached through smaltts, and every database call is (DECISIONS.md, 2026-11-23: "smaltai's storage").
 * {@link memoryStore} keeps them in memory, for tests. The database-backed store is `@smaltworks/smaltai/store`, still
 * to be built.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** A store in memory. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => void map.set(key, value),
    removeItem: async (key) => void map.delete(key),
  };
}

/** Reads JSON from a store; `null` if missing or unreadable. */
export async function readJson(store: KeyValueStore, key: string): Promise<unknown> {
  const text = await store.getItem(key);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Runs the functions given to it one at a time, in the order given, so a change that reads and then writes the store
 * can't interleave with another and lose it. A failure is passed to its caller and doesn't stop the ones after it.
 */
export function serial(): <T>(fn: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = last.then(fn, fn);
    last = next.catch(() => {});
    return next;
  };
}
