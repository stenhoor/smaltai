/**
 * The log (ADR 0043, section 5): every request and response in full, every action with its input and result, every
 * grant change and approval. It stays in the browser and can be exported as a file. Nothing is sent anywhere.
 */

/** What an entry records. */
export type LogKind = 'request' | 'response' | 'action' | 'result' | 'approval' | 'grant' | 'error' | 'stop';

/** One entry. `data` is plain JSON. */
export interface LogEntry {
  seq: number;
  /** ISO 8601. */
  time: string;
  kind: LogKind;
  data: unknown;
}

/**
 * Where entries go. Asynchronous, because the log in a page is kept in a database of smaltai's own, reached through
 * smaltts (DECISIONS.md, 2026-11-23: "smaltai's storage"); that store is `@smaltworks/smaltai/store`.
 * {@link memoryLog} keeps entries in memory, for tests. `append` resolves once the entry is recorded: the agent waits
 * for it before a request leaves, so the log holds everything that left the browser (ADR 0043 section 5).
 */
export interface Log {
  /** Records an entry. Entries are numbered in the order `append` is called. */
  append(kind: LogKind, data: unknown): Promise<LogEntry>;
  entries(): Promise<readonly LogEntry[]>;
  /** Calls `listener` for each new entry; returns a function that stops it. */
  subscribe(listener: (entry: LogEntry) => void): () => void;
}

/** A log in memory. `now` is for tests. */
export function memoryLog(options: { now?: () => Date } = {}): Log {
  const now = options.now ?? (() => new Date());
  const list: LogEntry[] = [];
  const listeners = new Set<(entry: LogEntry) => void>();
  return {
    async append(kind, data) {
      // A copy, so later changes to the caller's objects don't change what was logged.
      const entry: LogEntry = { seq: list.length + 1, time: now().toISOString(), kind, data: logData(data) };
      list.push(entry);
      for (const listener of listeners) listener(entry);
      return entry;
    },
    entries: async () => [...list],
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * The JSON form an entry's data is logged in, taken when `append` is called: errors become their name, message and
 * code, and later changes to the caller's objects don't change what was logged. Every log stores this form.
 */
export function logData(data: unknown): unknown {
  if (data === undefined) return null;
  return JSON.parse(JSON.stringify(data, (_key, value: unknown) => (value instanceof Error ? { name: value.name, message: value.message, code: (value as { code?: unknown }).code } : value)));
}

/** The log as JSON Lines, one entry a line: the export file. */
export function logToJsonl(entries: readonly LogEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : '');
}
