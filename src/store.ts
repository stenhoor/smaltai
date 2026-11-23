/**
 * Where the router and the grants remember things. {@link memoryStore} keeps them in memory; the store in a page is
 * smaltdb, in a database of smaltai's own (DECISIONS.md, 2026-11-23), and is still to be built.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A store in memory. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Reads JSON from a store; `null` if missing or unreadable. */
export function readJson(store: KeyValueStore, key: string): unknown {
  const text = store.getItem(key);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
