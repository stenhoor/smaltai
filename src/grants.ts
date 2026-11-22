/**
 * Grants (ADR 0043, section 4): what the agent may see and do, per endpoint and database, remembered and revocable.
 *
 * - A **data level** per database: schema only, schema and statistics, schema and sample rows, or full data.
 * - **Exclusions** per table and column, whatever the level. Excluded columns never leave the browser.
 * - **Actions** the app declares, each granted or not. Changing data is off unless the user turns it on.
 * - **Configuration tables** always need the user's explicit approval, whatever is granted.
 *
 * Within its grants the agent acts without asking; outside them it asks ({@link decide}).
 */
import { SmaltaiError } from './errors.js';
import type { Log } from './log.js';
import { memoryStore, readJson, type KeyValueStore } from './store.js';

/** The data levels, from least to most. */
export const DATA_LEVELS = ['schema', 'statistics', 'sample', 'full'] as const;
export type DataLevel = (typeof DATA_LEVELS)[number];

/** True if `granted` covers `needed`. */
export function covers(granted: DataLevel, needed: DataLevel): boolean {
  return DATA_LEVELS.indexOf(granted) >= DATA_LEVELS.indexOf(needed);
}

/** What the agent may see of one database. */
export interface DataGrant {
  level: DataLevel;
  /** At the `sample` level: the most rows a sample or a query result may carry. */
  sampleRows: number;
  /** Tables the agent never sees. */
  excludeTables: string[];
  /** Columns the agent never sees, as `table.column`. */
  excludeColumns: string[];
}

/** What the agent may see and do with one endpoint on one database. */
export interface Grants {
  data: DataGrant;
  /** Actions granted by name. An action not listed has its declared default. */
  actions: Record<string, boolean>;
}

/** What an app declares about an action, for grants. */
export interface ActionPolicy {
  name: string;
  /** Changes something (the report, a view, data). A write runs without asking only where granted. */
  write: boolean;
  /** Whether a write is granted until the user says otherwise. Changing data is `false`. */
  grantedByDefault?: boolean;
  /** The data level the action reads at. Below it, the agent asks. */
  reads?: DataLevel;
  /** True if this call touches configuration tables: always asks. */
  touchesConfig?: (input: unknown) => boolean;
}

/** `allow`: run it. `ask`: ask the user first, with the reason. */
export type Decision = { verdict: 'allow' } | { verdict: 'ask'; reason: string };

/** Decides whether an action call runs within the grants. */
export function decide(grants: Grants, action: ActionPolicy, input: unknown): Decision {
  if (action.touchesConfig?.(input) === true) return { verdict: 'ask', reason: 'It touches configuration tables, which always need your approval.' };
  if (action.reads !== undefined && !covers(grants.data.level, action.reads)) {
    return { verdict: 'ask', reason: `It reads at the ${action.reads} level; you granted ${grants.data.level}.` };
  }
  if (action.write && !(grants.actions[action.name] ?? action.grantedByDefault ?? false)) {
    return { verdict: 'ask', reason: `"${action.name}" isn't granted.` };
  }
  return { verdict: 'allow' };
}

/** The grants before the user changes anything: schema only, a 100-row sample size, nothing excluded. */
export function defaultGrants(): Grants {
  return { data: { level: 'schema', sampleRows: 100, excludeTables: [], excludeColumns: [] }, actions: {} };
}

/** Checks grants as set or read back, and returns them normalized. Throws `GRANT_INVALID`. */
export function grants(input: unknown): Grants {
  const fail = (why: string): never => {
    throw new SmaltaiError('GRANT_INVALID', why);
  };
  if (typeof input !== 'object' || input === null) fail('Grants are an object.');
  const record = input as { data?: Partial<DataGrant>; actions?: unknown };
  const data = record.data ?? {};
  const level = data.level ?? 'schema';
  if (!DATA_LEVELS.includes(level)) fail(`A data level is one of: ${DATA_LEVELS.join(', ')}.`);
  const sampleRows = data.sampleRows ?? 100;
  if (!Number.isInteger(sampleRows) || sampleRows < 0) fail('sampleRows is a whole number, 0 or more.');
  const names = (list: unknown, what: string): string[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) return fail(`${what} is a list of names.`);
    return [...list];
  };
  const excludeTables = names(data.excludeTables, 'excludeTables');
  const excludeColumns = names(data.excludeColumns, 'excludeColumns');
  for (const column of excludeColumns) if (!column.includes('.')) fail(`An excluded column is "table.column": ${column}`);
  const actions: Record<string, boolean> = {};
  if (record.actions !== undefined) {
    if (typeof record.actions !== 'object' || record.actions === null) fail('actions maps names to true or false.');
    for (const [name, granted] of Object.entries(record.actions as object)) {
      if (typeof granted !== 'boolean') fail(`actions.${name} is true or false.`);
      actions[name] = granted;
    }
  }
  return { data: { level, sampleRows, excludeTables, excludeColumns }, actions };
}

/** True if a table may be shown to the model. */
export function tableAllowed(grant: DataGrant, table: string): boolean {
  return !grant.excludeTables.includes(table);
}

/** True if a column may be shown to the model. */
export function columnAllowed(grant: DataGrant, table: string, column: string): boolean {
  return tableAllowed(grant, table) && !grant.excludeColumns.includes(`${table}.${column}`);
}

/** A table of rows as an app hands it over: the source table of each column, by position. */
export interface Rows {
  columns: { name: string; table?: string }[];
  rows: unknown[][];
}

/**
 * Shapes rows for the model under a data grant: drops excluded columns, and keeps no rows below the `sample` level and
 * at most `sampleRows` at it. Returns how many rows and columns were withheld, to say so.
 */
export function shapeRows(grant: DataGrant, input: Rows): Rows & { withheldRows: number; withheldColumns: string[] } {
  const keep: number[] = [];
  const withheldColumns: string[] = [];
  input.columns.forEach((column, i) => {
    if (column.table === undefined || columnAllowed(grant, column.table, column.name)) keep.push(i);
    else withheldColumns.push(`${column.table}.${column.name}`);
  });
  const limit = grant.level === 'full' ? input.rows.length : grant.level === 'sample' ? Math.min(grant.sampleRows, input.rows.length) : 0;
  return {
    columns: keep.map((i) => input.columns[i]!),
    rows: input.rows.slice(0, limit).map((row) => keep.map((i) => row[i])),
    withheldRows: input.rows.length - limit,
    withheldColumns,
  };
}

/** Where grants are kept, per endpoint and database, with every change logged. */
export interface GrantStore {
  get(endpointId: string, database: string): Grants;
  set(endpointId: string, database: string, grants: unknown): Grants;
  /** Back to {@link defaultGrants}. */
  revoke(endpointId: string, database: string): void;
  /** Every remembered grant, for the grants panel. */
  list(): { endpointId: string; database: string; grants: Grants }[];
}

export function createGrantStore(options: { store?: KeyValueStore; log?: Log; prefix?: string } = {}): GrantStore {
  const store = options.store ?? memoryStore();
  const key = `${options.prefix ?? 'smaltai'}.grants`;
  type Saved = Record<string, { endpointId: string; database: string; grants: unknown }>;
  const load = (): Saved => {
    const raw = readJson(store, key);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Saved) : {};
  };
  const id = (endpointId: string, database: string) => JSON.stringify([endpointId, database]);
  const read = (value: unknown): Grants => {
    try {
      return grants(value);
    } catch {
      return defaultGrants();
    }
  };
  return {
    get(endpointId, database) {
      const saved = load()[id(endpointId, database)];
      return saved === undefined ? defaultGrants() : read(saved.grants);
    },
    set(endpointId, database, input) {
      const checked = grants(input);
      const all = load();
      all[id(endpointId, database)] = { endpointId, database, grants: checked };
      store.setItem(key, JSON.stringify(all));
      options.log?.append('grant', { change: 'set', endpointId, database, grants: checked });
      return checked;
    },
    revoke(endpointId, database) {
      const all = load();
      delete all[id(endpointId, database)];
      store.setItem(key, JSON.stringify(all));
      options.log?.append('grant', { change: 'revoked', endpointId, database });
    },
    list() {
      return Object.values(load()).map((s) => ({ endpointId: s.endpointId, database: s.database, grants: read(s.grants) }));
    },
  };
}
