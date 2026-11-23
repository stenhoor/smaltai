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
import { serial } from './serial.js';

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

/**
 * What an app declares about an action, for grants. The fields follow ADR 0025 section 4: its kind, what it touches,
 * and whether it can be undone.
 */
export interface ActionPolicy {
  name: string;
  /** `read` looks at something; `write` changes data, a document or the app (ADR 0025 section 4). */
  kind: 'read' | 'write';
  /** What the action touches: which database, whether it reads rows, which document (ADR 0025 section 4). */
  touches: { database?: string; rows: boolean; document?: string };
  /** False for an action that can't be undone, so the chat can say so (ADR 0025 section 4). */
  undoable: boolean;
  /**
   * True if the action runs code the model wrote (a notebook cell, a TypeScript tab). It is a write, and runs only
   * where the user granted it by name or approves it: never by default (DECISIONS.md, 2026-11-23).
   */
  runsCode?: boolean;
  /** Whether a write is granted until the user says otherwise. Changing data has no default grant (ADR 0043 section 4). */
  grantedByDefault?: boolean;
  /** The data level the action reads at. Below it, the agent asks. */
  reads?: DataLevel;
  /** True if this call touches configuration tables: it always asks (ADR 0043 section 4). */
  touchesConfig?: (input: unknown) => boolean;
}

/**
 * `allow`: run it. `ask`: ask the user first, with the reason. `grantable` says whether the user may grant the action
 * from the question (ADR 0025 section 5, "allow it once or grant it"): not for configuration tables, which always ask,
 * and not for a data level, which is changed in the grants panel.
 */
export type Decision = { verdict: 'allow' } | { verdict: 'ask'; reason: string; grantable: boolean };

/** True if the action changes something: a write, or code the model wrote. */
export function isWrite(action: ActionPolicy): boolean {
  return action.kind === 'write' || action.runsCode === true;
}

/** Decides whether an action call runs within the grants. */
export function decide(grants: Grants, action: ActionPolicy, input: unknown): Decision {
  if (action.touchesConfig?.(input) === true) {
    return { verdict: 'ask', reason: 'It touches configuration tables, which always need your approval.', grantable: false };
  }
  if (action.reads !== undefined && !covers(grants.data.level, action.reads)) {
    return { verdict: 'ask', reason: `It reads at the ${action.reads} level; you granted ${grants.data.level}.`, grantable: false };
  }
  if (isWrite(action)) {
    const byDefault = action.runsCode === true ? false : (action.grantedByDefault ?? false);
    if (!(grants.actions[action.name] ?? byDefault)) {
      return { verdict: 'ask', reason: action.runsCode === true ? `"${action.name}" runs code the model wrote.` : `"${action.name}" isn't granted.`, grantable: true };
    }
  }
  return { verdict: 'allow' };
}

/**
 * The warning shown when the user grants sample rows or full data (ADR 0025 section 5; shown once, as part of the
 * grant: DECISIONS.md, 2026-11-23).
 */
export const ROWS_WARNING =
  'Rows from your data will be sent to this gateway. A local gateway may pass them on to a hosted model, and smaltai ' +
  "can't tell whether it does.";

/**
 * The grants before the user changes anything: schema only (ADR 0025 section 5), a 100-row sample size the user can
 * change (DECISIONS.md, 2026-11-23), nothing excluded.
 */
export function defaultGrants(): Grants {
  return { data: { level: 'schema', sampleRows: 100, excludeTables: [], excludeColumns: [] }, actions: {} };
}

/** Checks grants as set or read back, and returns them normalized. Throws `SMALTAI_GRANT_INVALID`. */
export function grants(input: unknown): Grants {
  const fail = (why: string): never => {
    throw new SmaltaiError('SMALTAI_GRANT_INVALID', why);
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

/**
 * Where grants are kept, per endpoint and database, with every change logged. Asynchronous, as its store is
 * (DECISIONS.md, 2026-11-23: "smaltai's storage").
 */
export interface GrantStore {
  get(endpointId: string, database: string): Promise<Grants>;
  /**
   * Sets the grants. Raising the data level to sample rows or full data needs `rowsWarningShown: true`: the app showed
   * {@link ROWS_WARNING} and the user confirmed the grant with it. Otherwise throws `SMALTAI_GRANT_INVALID`.
   */
  set(endpointId: string, database: string, grants: unknown, options?: { rowsWarningShown?: boolean }): Promise<Grants>;
  /** Back to {@link defaultGrants}. */
  revoke(endpointId: string, database: string): Promise<void>;
  /** Every remembered grant, for the grants panel. */
  list(): Promise<{ endpointId: string; database: string; grants: Grants }[]>;
}

/**
 * Where a grant store keeps grants: in memory ({@link memoryGrantRecords}), or in smaltai's own database through smaltts
 * (`@smaltworks/smaltai/store`). Grants come back as they were stored, and the grant store checks each again.
 */
export interface GrantRecords {
  /** The stored grants, or `null`. */
  get(endpointId: string, database: string): Promise<unknown>;
  put(endpointId: string, database: string, grants: Grants): Promise<void>;
  delete(endpointId: string, database: string): Promise<void>;
  list(): Promise<{ endpointId: string; database: string; grants: unknown }[]>;
}

/** Grant records in memory. */
export function memoryGrantRecords(): GrantRecords {
  const map = new Map<string, { endpointId: string; database: string; grants: unknown }>();
  const id = (endpointId: string, database: string) => JSON.stringify([endpointId, database]);
  return {
    get: async (endpointId, database) => map.get(id(endpointId, database))?.grants ?? null,
    put: async (endpointId, database, grants) => void map.set(id(endpointId, database), { endpointId, database, grants: structuredClone(grants) }),
    delete: async (endpointId, database) => void map.delete(id(endpointId, database)),
    list: async () => [...map.values()].map((v) => ({ ...v })),
  };
}

export function createGrantStore(options: { store?: GrantRecords; log?: Log } = {}): GrantStore {
  const records = options.store ?? memoryGrantRecords();
  const oneAtATime = serial();
  // Stored grants are checked again when read; anything that isn't valid grants counts as the defaults.
  const read = (value: unknown): Grants => {
    if (value === null || value === undefined) return defaultGrants();
    try {
      return grants(value);
    } catch {
      return defaultGrants();
    }
  };
  return {
    get(endpointId, database) {
      return oneAtATime(async () => read(await records.get(endpointId, database)));
    },
    async set(endpointId, database, input, setOptions = {}) {
      const checked = grants(input);
      return oneAtATime(async () => {
        const was = read(await records.get(endpointId, database)).data.level;
        if (covers(checked.data.level, 'sample') && !covers(was, 'sample') && setOptions.rowsWarningShown !== true) {
          throw new SmaltaiError('SMALTAI_GRANT_INVALID', `Granting ${checked.data.level} sends rows: show ROWS_WARNING and confirm it first.`);
        }
        await records.put(endpointId, database, checked);
        await options.log?.append('grant', { change: 'set', endpointId, database, grants: checked, rowsWarningShown: setOptions.rowsWarningShown === true });
        return checked;
      });
    },
    revoke(endpointId, database) {
      return oneAtATime(async () => {
        await records.delete(endpointId, database);
        await options.log?.append('grant', { change: 'revoked', endpointId, database });
      });
    },
    list() {
      return oneAtATime(async () => (await records.list()).map((s) => ({ endpointId: s.endpointId, database: s.database, grants: read(s.grants) })));
    },
  };
}
