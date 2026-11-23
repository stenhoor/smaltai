// The browser test's page: @smaltworks/smaltai/store through smaltdb's client, the engine in a Web Worker, as an app
// uses it (the owner asked for it on 2026-11-23). Two workers: smaltts's worker entry, and smaltdb's own with no
// language registered (an app's worker may not register smaltts). Two storages: memory, and OPFS, where the database is
// closed and opened again to read back what was kept.
import { open } from 'smaltdb';
import { createGrantStore, createRouter } from '@smaltworks/smaltai';
import { attachStore } from '@smaltworks/smaltai/store';

const WORKERS = {
  'smaltts worker': () => new Worker('/test/browser/smaltts-worker.js', { type: 'module', name: 'smaltdb' }),
  'smaltdb worker, no language': () => new Worker('/node_modules/smaltdb/dist/smaltdb-worker.js', { type: 'module', name: 'smaltdb' }),
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function write(db) {
  const store = await attachStore(db);
  const router = createRouter({ store: store.router, log: store.log });
  const grants = createGrantStore({ store: store.grants, log: store.log });
  await router.save({ id: 'o', name: 'Ollama', url: 'http://localhost:11434', format: 'openai' });
  await router.choose('smaltbi', { endpointId: 'o', model: 'qwen' });
  await grants.set('o', 'sales.db', { data: { level: 'sample', sampleRows: 50 } }, { rowsWarningShown: true });
  // Appended at the same time: numbered in the order appended.
  await Promise.all([store.log.append('request', { n: 1 }), store.log.append('response', { n: 2 }), store.log.append('stop', { n: 3 })]);
}

async function read(db) {
  const store = await attachStore(db);
  const router = createRouter({ store: store.router });
  const grants = createGrantStore({ store: store.grants });
  return {
    endpoints: (await router.endpoints()).map((e) => e.id),
    choice: await router.choice('smaltbi'),
    sampleRows: (await grants.get('o', 'sales.db')).data.sampleRows,
    log: (await store.log.entries()).map((e) => [e.seq, e.kind]),
  };
}

const expected = {
  endpoints: ['o'],
  choice: { endpointId: 'o', model: 'qwen' },
  sampleRows: 50,
  log: [[1, 'grant'], [2, 'grant'], [3, 'request'], [4, 'response'], [5, 'stop']],
};

async function run() {
  const out = [];
  for (const [label, worker] of Object.entries(WORKERS)) {
    for (const storage of ['memory', 'opfs']) {
      const name = `${label}, ${storage}`;
      try {
        const file = storage === 'opfs' ? `smaltai-${Math.random().toString(36).slice(2)}.db` : ':memory:';
        let db = await open(file, { storage, multiTab: false, worker });
        await write(db);
        if (storage === 'opfs') {
          // What was kept, read back after the database is closed and opened again.
          await db.close();
          db = await open(file, { storage, multiTab: false, worker });
        }
        const got = await read(db);
        await db.close();
        out.push(same(got, expected) ? { name, ok: true } : { name, ok: false, detail: `expected ${JSON.stringify(expected)}\ngot      ${JSON.stringify(got)}` });
      } catch (e) {
        // WebKit's stack omits the name and message (smaltdb's test/browser/opfs-worker.ts notes it): give both.
        out.push({ name, ok: false, detail: `${e?.name ?? 'Error'}: ${e?.message ?? e}${e?.code ? ` (${e.code})` : ''}\n${e?.stack ?? ''}` });
      }
    }
  }
  return out;
}

globalThis.results = await run();
