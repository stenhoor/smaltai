/**
 * `@smaltworks/smaltai/store`: smaltai's log, grants, endpoints and chosen models, kept in a database of smaltai's own
 * and reached through smaltts (smaltworks DECISIONS.md, 2026-11-23: "smaltai reaches the database through smaltts" and
 * "smaltai's storage: the entry point, the interfaces and smaltts's build").
 *
 * The app opens the database with the engine loading it already has, separate from the user's data, and passes it to
 * {@link attachStore}, which attaches smaltts and creates the four tables (the owner agreed them on stenhoor/smaltai#5).
 * smaltai ships no worker. This entry point is the only part of smaltai that imports smaltts; the core imports neither
 * smaltts nor smaltdb.
 */
import { attach, datetime, int, scan, table, text } from '@smaltworks/smaltts';
import type { GrantRecords } from './grants.js';
import { logData, type Log, type LogEntry, type LogKind } from './log.js';
import type { RouterStore } from './router.js';
import { serial } from './serial.js';

/** The log: one row an entry, its data as JSON text. */
export const logTable = table('smaltai_log', {
  seq: int().primaryKey(),
  time: datetime().notNull(),
  kind: text().notNull(),
  data: text().notNull(),
});

/** The endpoints the user registered: an address and a format, never a key. */
export const endpointsTable = table('smaltai_endpoints', {
  id: text().primaryKey(),
  name: text().notNull(),
  url: text().notNull(),
  format: text().notNull(),
});

/** Grants per endpoint and database, as JSON text. */
export const grantsTable = table(
  'smaltai_grants',
  { endpointId: text().notNull(), database: text().notNull(), grants: text().notNull() },
  { primaryKey: ['endpointId', 'database'] },
);

/** The endpoint and model chosen for each scope (an app, a report). */
export const choicesTable = table('smaltai_choices', {
  scope: text().primaryKey(),
  endpointId: text().notNull(),
  model: text().notNull(),
});

/** What {@link attachStore} gives: a log, and the stores `createRouter` and `createGrantStore` take. */
export interface Store {
  log: Log;
  router: RouterStore;
  grants: GrantRecords;
}

/** The database the app opened for smaltai: what smaltts's `attach` takes (smaltdb's client or engine `Database`). */
export type StoreDatabase = Parameters<typeof attach>[0];

/**
 * Attaches smaltts to smaltai's own database and creates its four tables where they don't exist yet
 * (`migrate`, which changes nothing that would lose data).
 */
export async function attachStore(database: StoreDatabase, options: { now?: () => Date } = {}): Promise<Store> {
  const db = attach(database);
  await db.migrate({ tables: [logTable, endpointsTable, grantsTable, choicesTable] });
  type Db = typeof db;
  return { log: storeLog(db, options.now ?? (() => new Date())), router: storeRouter(db), grants: storeGrants(db) };

  function storeLog(db: Db, now: () => Date): Log {
    const listeners = new Set<(entry: LogEntry) => void>();
    const oneAtATime = serial();
    return {
      append(kind, data) {
        // Taken now, so later changes to the caller's objects don't change what is logged.
        const json = JSON.stringify(logData(data));
        const time = now();
        return oneAtATime(async () => {
          // The next number and the row in one transaction: the client runs a connection's transactions one at a
          // time, so two tabs sharing the database can't take the same number.
          const entry = await db.transaction(async (tx) => {
            const [last] = await tx.rows(scan(logTable).sort('-seq').limit(1));
            const seq = (last?.seq ?? 0) + 1;
            await tx.load(logTable, [{ seq, time, kind, data: json }]);
            return { seq, time: time.toISOString(), kind, data: JSON.parse(json) as unknown };
          });
          for (const listener of listeners) listener(entry);
          return entry;
        });
      },
      async entries() {
        const rows = await db.rows(scan(logTable).sort('seq'));
        return rows.map((r) => ({ seq: r.seq, time: r.time.toISOString(), kind: r.kind as LogKind, data: JSON.parse(r.data) as unknown }));
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
  }

  function storeRouter(db: Db): RouterStore {
    return {
      endpoints: () => db.rows(scan(endpointsTable)),
      async putEndpoint(e) {
        await db.load(endpointsTable, [{ id: e.id, name: e.name, url: e.url, format: e.format }], { mode: 'upsert' });
      },
      deleteEndpoint: (id) => db.deleteWhere(endpointsTable, (r) => r.id.eq(id)),
      async choice(scope) {
        const [row] = await db.rows(scan(choicesTable).filter((r) => r.scope.eq(scope)));
        return row === undefined ? null : { endpointId: row.endpointId, model: row.model };
      },
      async putChoice(scope, choice) {
        await db.load(choicesTable, [{ scope, endpointId: choice.endpointId, model: choice.model }], { mode: 'upsert' });
      },
    };
  }

  function storeGrants(db: Db): GrantRecords {
    return {
      async get(endpointId, database) {
        const [row] = await db.rows(scan(grantsTable).filter((r) => r.endpointId.eq(endpointId).and(r.database.eq(database))));
        return row === undefined ? null : parse(row.grants);
      },
      async put(endpointId, database, grants) {
        await db.load(grantsTable, [{ endpointId, database, grants: JSON.stringify(grants) }], { mode: 'upsert' });
      },
      delete: (endpointId, database) => db.deleteWhere(grantsTable, (r) => r.endpointId.eq(endpointId).and(r.database.eq(database))),
      async list() {
        return (await db.rows(scan(grantsTable))).map((r) => ({ endpointId: r.endpointId, database: r.database, grants: parse(r.grants) }));
      },
    };
  }
}

/** Stored text read back as JSON; text that isn't JSON comes back as `null`, which the grant store treats as none. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
