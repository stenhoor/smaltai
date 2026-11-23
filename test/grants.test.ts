import { test } from 'node:test';
import assert from 'node:assert/strict';
import { covers, ROWS_WARNING, createGrantStore, decide, defaultGrants, grants, memoryLog, memoryStore, shapeRows, SmaltaiError, type ActionPolicy } from '@smaltworks/smaltai';

const changeReport: ActionPolicy = { name: 'change_report', kind: 'write', touches: { rows: false, document: 'report' }, undoable: true, grantedByDefault: true };
const changeData: ActionPolicy = { name: 'change_data', kind: 'write', touches: { database: 'sales.db', rows: true }, undoable: false };
const runQuery: ActionPolicy = {
  name: 'run_query',
  kind: 'read',
  touches: { database: 'sales.db', rows: true },
  undoable: true,
  reads: 'sample',
  touchesConfig: (input) => /config/.test(String((input as { sql?: string }).sql)),
};
const runCell: ActionPolicy = { name: 'run_cell', kind: 'read', touches: { rows: true }, undoable: false, runsCode: true, grantedByDefault: true };

test('levels are ordered', () => {
  assert.ok(covers('full', 'sample'));
  assert.ok(covers('statistics', 'schema'));
  assert.ok(!covers('schema', 'statistics'));
});

test('writes run where granted, and changing data is off unless turned on', () => {
  const g = defaultGrants();
  assert.deepEqual(decide(g, changeReport, {}), { verdict: 'allow' });
  assert.equal(decide(g, changeData, {}).verdict, 'ask');
  assert.equal(decide({ ...g, actions: { change_data: true } }, changeData, {}).verdict, 'allow');
  assert.equal(decide({ ...g, actions: { change_report: false } }, changeReport, {}).verdict, 'ask');
  assert.deepEqual(decide(g, changeData, {}), { verdict: 'ask', reason: '"change_data" isn\'t granted.', grantable: true });
});

test('code the model wrote never runs by default, whatever the action declares', () => {
  const g = defaultGrants();
  const d = decide(g, runCell, {});
  assert.equal(d.verdict, 'ask');
  assert.match((d as { reason: string }).reason, /code the model wrote/);
  assert.equal(decide({ ...g, actions: { run_cell: true } }, runCell, {}).verdict, 'allow');
});

test('reading above the granted level asks', () => {
  const g = defaultGrants();
  assert.equal(decide(g, runQuery, { sql: 'select 1' }).verdict, 'ask');
  assert.equal(decide({ ...g, data: { ...g.data, level: 'sample' } }, runQuery, { sql: 'select 1' }).verdict, 'allow');
});

test('configuration tables always ask, whatever is granted', () => {
  const full = grants({ data: { level: 'full' }, actions: { run_query: true } });
  const d = decide(full, runQuery, { sql: 'select * from config' });
  assert.equal(d.verdict, 'ask');
  assert.match((d as { reason: string }).reason, /configuration/);
  assert.equal((d as { grantable: boolean }).grantable, false);
});

test('rows are shaped by the grant', () => {
  const input = {
    columns: [{ name: 'id', table: 'people' }, { name: 'salary', table: 'people' }, { name: 'n' }],
    rows: [[1, 10, 'a'], [2, 20, 'b'], [3, 30, 'c']],
  };
  const sample = { level: 'sample' as const, sampleRows: 2, excludeTables: [], excludeColumns: ['people.salary'] };
  assert.deepEqual(shapeRows(sample, input), {
    columns: [{ name: 'id', table: 'people' }, { name: 'n' }],
    rows: [[1, 'a'], [2, 'b']],
    withheldRows: 1,
    withheldColumns: ['people.salary'],
  });
  assert.equal(shapeRows({ ...sample, level: 'statistics' }, input).rows.length, 0);
  assert.equal(shapeRows({ ...sample, level: 'full' }, input).rows.length, 3);
  assert.deepEqual(shapeRows({ ...sample, level: 'full', excludeTables: ['people'] }, input).columns, [{ name: 'n' }]);
});

test('invalid grants are refused', () => {
  const invalid = (e: unknown) => e instanceof SmaltaiError && e.code === 'SMALTAI_GRANT_INVALID';
  assert.throws(() => grants({ data: { level: 'everything' } }), invalid);
  assert.throws(() => grants({ data: { sampleRows: -1 } }), invalid);
  assert.throws(() => grants({ data: { excludeColumns: ['salary'] } }), invalid);
  assert.throws(() => grants({ actions: { a: 'yes' } }), invalid);
});

test('grants are remembered per endpoint and database, revocable, and every change is logged', () => {
  const store = memoryStore();
  const log = memoryLog();
  const s = createGrantStore({ store, log });
  assert.throws(() => s.set('ollama', 'sales.db', { data: { level: 'sample' } }), (e: unknown) => e instanceof SmaltaiError && e.code === 'SMALTAI_GRANT_INVALID');
  s.set('ollama', 'sales.db', { data: { level: 'sample', sampleRows: 50 } }, { rowsWarningShown: true });
  // Already at sample: changing the size or the actions needs no second warning.
  s.set('ollama', 'sales.db', { data: { level: 'sample', sampleRows: 20 } });
  assert.equal(createGrantStore({ store }).get('ollama', 'sales.db').data.level, 'sample');
  assert.equal(s.get('ollama', 'other.db').data.level, 'schema');
  assert.equal(s.get('litellm', 'sales.db').data.level, 'schema');
  assert.equal(s.list().length, 1);
  s.revoke('ollama', 'sales.db');
  assert.equal(s.get('ollama', 'sales.db').data.level, 'schema');
  assert.deepEqual(log.entries().map((e) => [e.kind, (e.data as { change: string }).change]), [['grant', 'set'], ['grant', 'set'], ['grant', 'revoked']]);
});

test('the rows warning says a local gateway may pass rows on', () => {
  assert.match(ROWS_WARNING, /may pass them on to a hosted model/);
});
