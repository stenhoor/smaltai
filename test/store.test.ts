// @smaltworks/smaltai/store: the log, grants, endpoints and choices in smaltai's own database, through smaltts, on
// smaltdb's engine in process (the app passes a client Database in a page; smaltts treats both the same).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Database } from 'smaltdb/engine';
import { createGrantStore, createRouter, defaultGrants, runAgent, SmaltaiError } from '@smaltworks/smaltai';
import { attachStore } from '@smaltworks/smaltai/store';
import { scriptedGateway } from './helpers.ts';

const clock = () => {
  let t = Date.parse('2026-11-23T10:00:00Z');
  return () => new Date((t += 1000));
};

test('the four tables are created, and what is stored is there when the database is attached again', async () => {
  const database = Database.openMemory();
  const first = await attachStore(database, { now: clock() });
  await first.log.append('request', { model: 'm' });
  await first.router.putEndpoint({ id: 'o', name: 'Ollama', url: 'http://localhost:11434', format: 'openai' });
  await first.router.putChoice('smaltbi', { endpointId: 'o', model: 'qwen' });
  await first.grants.put('o', 'sales.db', defaultGrants());

  const again = await attachStore(database);
  assert.deepEqual((await again.log.entries()).map((e) => [e.seq, e.kind, e.data]), [[1, 'request', { model: 'm' }]]);
  assert.deepEqual(await again.router.endpoints(), [{ id: 'o', name: 'Ollama', url: 'http://localhost:11434', format: 'openai' }]);
  assert.deepEqual(await again.router.choice('smaltbi'), { endpointId: 'o', model: 'qwen' });
  assert.deepEqual(await again.grants.get('o', 'sales.db'), defaultGrants());
  assert.deepEqual(
    database.catalog.tables().map((t: { name: string }) => t.name).filter((n: string) => n.startsWith('smaltai_')).sort(),
    ['smaltai_choices', 'smaltai_endpoints', 'smaltai_grants', 'smaltai_log'],
  );
});

test('the log numbers entries in the order they were appended, at the same time too, and keeps copies', async () => {
  const { log } = await attachStore(Database.openMemory(), { now: clock() });
  const data = { n: 1 };
  const appended = log.append('request', data);
  data.n = 2;
  await Promise.all([appended, log.append('response', { n: 3 }), log.append('error', { error: Object.assign(new Error('boom'), { code: 'X' }) })]);
  const entries = await log.entries();
  assert.deepEqual(entries.map((e) => [e.seq, e.kind]), [[1, 'request'], [2, 'response'], [3, 'error']]);
  assert.deepEqual(entries[0]!.data, { n: 1 });
  assert.deepEqual(entries[2]!.data, { error: { name: 'Error', message: 'boom', code: 'X' } });
  assert.equal(entries[0]!.time, '2026-11-23T10:00:01.000Z');
});

test('subscribers hear each entry as it is recorded', async () => {
  const { log } = await attachStore(Database.openMemory());
  const heard: number[] = [];
  const stop = log.subscribe((e) => heard.push(e.seq));
  await log.append('stop', {});
  stop();
  await log.append('stop', {});
  assert.deepEqual(heard, [1]);
});

test('the router and the grant store work over the store, and every change is logged in it', async () => {
  const store = await attachStore(Database.openMemory());
  const router = createRouter({ store: store.router, log: store.log });
  await router.save({ id: 'o', name: 'Ollama', url: 'http://localhost:11434/v1', format: 'openai' });
  await router.save({ id: 'o', name: 'Ollama (laptop)', url: 'http://localhost:11434', format: 'openai' });
  await router.save({ id: 'l', name: 'llama-server', url: 'http://127.0.0.1:8080', format: 'openai' });
  await router.remove('l');
  assert.deepEqual(await router.endpoints(), [{ id: 'o', name: 'Ollama (laptop)', url: 'http://localhost:11434', format: 'openai' }]);
  await router.choose('smaltbi', { endpointId: 'o', model: 'qwen' });
  await router.choose('smaltbi', { endpointId: 'o', model: 'llama' });
  assert.deepEqual(await router.choice('smaltbi'), { endpointId: 'o', model: 'llama' });

  const grants = createGrantStore({ store: store.grants, log: store.log });
  await assert.rejects(grants.set('o', 'sales.db', { data: { level: 'full' } }), (e: unknown) => e instanceof SmaltaiError && e.code === 'SMALTAI_GRANT_INVALID');
  await grants.set('o', 'sales.db', { data: { level: 'sample', sampleRows: 50 } }, { rowsWarningShown: true });
  await grants.set('o', 'other.db', { actions: { change_report: true } });
  assert.equal((await grants.get('o', 'sales.db')).data.sampleRows, 50);
  assert.equal((await grants.get('o', 'other.db')).data.level, 'schema');
  assert.deepEqual((await grants.list()).map((g) => g.database).sort(), ['other.db', 'sales.db']);
  await grants.revoke('o', 'sales.db');
  assert.equal((await grants.get('o', 'sales.db')).data.level, 'schema');

  const changes = (await store.log.entries()).map((e) => (e.data as { change: string }).change);
  assert.deepEqual(changes, ['endpoint saved', 'endpoint saved', 'endpoint saved', 'endpoint removed', 'set', 'set', 'revoked']);
});

test('the agent records each request in the store before it is sent', async () => {
  const store = await attachStore(Database.openMemory());
  const gateway = scriptedGateway([[{ type: 'text', text: 'hi' }, { type: 'done', reason: 'stop' }]]);
  await runAgent({ gateway, model: 'm', actions: [], grants: async () => defaultGrants(), approve: async () => 'once', log: store.log }, [{ role: 'user', content: 'hello' }]);
  const entries = await store.log.entries();
  assert.deepEqual(entries.map((e) => e.kind), ['request', 'response']);
  assert.deepEqual((entries[0]!.data as { messages: { content: string }[] }).messages.at(-1)!.content, 'hello');
});

test('only the store entry point imports smaltts or smaltdb: the core has no dependencies', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const file of readdirSync(dir)) {
    if (file === 'store.ts') continue;
    const text = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(text, /from '(@smaltworks\/smaltts|smaltdb)(\/[^']*)?'/, file);
  }
  assert.doesNotMatch(readFileSync(new URL('index.ts', dir), 'utf8'), /store\.js/);
});
