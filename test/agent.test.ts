import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGrants, grants, memoryLog, runAgent, type Action, type ApprovalRequest, type Grants } from '@smaltworks/smaltai';
import { scriptedGateway } from './helpers.ts';

function actions(ran: string[]): Action[] {
  return [
    {
      name: 'list_tables',
      description: 'Lists the tables.',
      inputSchema: { type: 'object', properties: {} },
      write: false,
      reads: 'schema',
      run: async () => {
        ran.push('list_tables');
        return ['sales'];
      },
    },
    {
      name: 'run_query',
      description: 'Runs a query.',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
      write: false,
      reads: 'sample',
      run: async (input) => {
        ran.push(`run_query ${input.sql}`);
        return { rows: [[1]] };
      },
    },
    {
      name: 'change_data',
      description: 'Changes data.',
      inputSchema: { type: 'object' },
      write: true,
      run: async () => {
        ran.push('change_data');
        return 'done';
      },
    },
  ];
}

const call = (id: string, name: string, args: unknown = {}) => ({ type: 'tool_call' as const, call: { id, name, arguments: args } });

test('runs granted actions without asking, and returns results as data', async () => {
  const ran: string[] = [];
  const asked: ApprovalRequest[] = [];
  const gateway = scriptedGateway([
    [call('c1', 'list_tables'), { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'done', reason: 'tool_calls' }],
    [{ type: 'text', text: 'There is one table.' }, { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } }, { type: 'done', reason: 'stop' }],
  ]);
  const log = memoryLog();
  const result = await runAgent(
    { gateway, model: 'm', actions: actions(ran), grants: defaultGrants, approve: async (r) => (asked.push(r), true), log, system: 'You help with reports.' },
    [{ role: 'user', content: 'What tables are there?' }],
  );
  assert.equal(result.outcome, 'done');
  assert.deepEqual(ran, ['list_tables']);
  assert.equal(asked.length, 0);
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 8 });
  const tool = result.messages.find((m) => m.role === 'tool')!;
  assert.equal(tool.toolCallId, 'c1');
  assert.match(tool.content, /^<untrusted-data source="list_tables">/);
  assert.match(result.messages[0]!.content, /You help with reports\.[\s\S]*untrusted-data/);
  assert.deepEqual(gateway.requests[0]!.tools!.map((t) => t.name), ['list_tables', 'run_query', 'change_data']);
  assert.deepEqual(Object.keys(gateway.requests[0]!.tools![0]!), ['name', 'description', 'inputSchema']);
  assert.deepEqual(log.entries().map((e) => e.kind), ['request', 'response', 'action', 'result', 'request', 'response']);
});

test('asks outside the grants, and a refusal is told to the model', async () => {
  const ran: string[] = [];
  const asked: ApprovalRequest[] = [];
  const gateway = scriptedGateway([
    [call('c1', 'run_query', { sql: 'select 1' }), call('c2', 'change_data'), { type: 'done', reason: 'tool_calls' }],
    [{ type: 'text', text: 'ok' }, { type: 'done', reason: 'stop' }],
  ]);
  const log = memoryLog();
  const result = await runAgent(
    { gateway, model: 'm', actions: actions(ran), grants: defaultGrants, approve: async (r) => (asked.push(r), r.action === 'run_query'), log },
    [{ role: 'user', content: 'go' }],
  );
  assert.deepEqual(asked.map((a) => a.action), ['run_query', 'change_data']);
  assert.deepEqual(ran, ['run_query select 1']);
  assert.match(result.messages.find((m) => m.toolCallId === 'c2')!.content, /declined/);
  assert.deepEqual(
    log.entries().filter((e) => e.kind === 'approval').map((e) => (e.data as { approved: boolean }).approved),
    [true, false],
  );
});

test('grants are read at every call, so a revoke takes effect at once', async () => {
  const ran: string[] = [];
  let current: Grants = grants({ data: { level: 'full' } });
  const gateway = scriptedGateway([
    [call('c1', 'run_query', { sql: 'a' }), { type: 'done', reason: 'tool_calls' }],
    [call('c2', 'run_query', { sql: 'b' }), { type: 'done', reason: 'tool_calls' }],
    [{ type: 'done', reason: 'stop' }],
  ]);
  const acts = actions(ran);
  acts[1]!.run = async (input) => {
    ran.push(String(input.sql));
    current = defaultGrants();
    return 1;
  };
  let asks = 0;
  await runAgent({ gateway, model: 'm', actions: acts, grants: () => current, approve: async () => (asks++, false), log: memoryLog() }, []);
  assert.deepEqual(ran, ['a']);
  assert.equal(asks, 1);
});

test('unknown actions and bad arguments are answered, not run', async () => {
  const ran: string[] = [];
  const gateway = scriptedGateway([
    [call('c1', 'drop_everything'), call('c2', 'run_query', '{bad'), { type: 'done', reason: 'tool_calls' }],
    [{ type: 'done', reason: 'stop' }],
  ]);
  const result = await runAgent({ gateway, model: 'm', actions: actions(ran), grants: () => grants({ data: { level: 'full' } }), approve: async () => true, log: memoryLog() }, []);
  assert.deepEqual(ran, []);
  assert.match(result.messages.find((m) => m.toolCallId === 'c1')!.content, /no action "drop_everything"/);
  assert.match(result.messages.find((m) => m.toolCallId === 'c2')!.content, /JSON object/);
});

test('an action that fails is told to the model as data', async () => {
  const acts = actions([]);
  acts[0]!.run = async () => {
    throw new Error('table locked');
  };
  const gateway = scriptedGateway([[call('c1', 'list_tables'), { type: 'done', reason: 'tool_calls' }], [{ type: 'done', reason: 'stop' }]]);
  const log = memoryLog();
  const result = await runAgent({ gateway, model: 'm', actions: acts, grants: defaultGrants, approve: async () => true, log }, []);
  assert.match(result.messages.find((m) => m.toolCallId === 'c1')!.content, /table locked/);
  assert.equal((log.entries().find((e) => e.kind === 'result')!.data as { ok: boolean }).ok, false);
});

test('the kill switch stops the agent and cancels the actions not yet run', async () => {
  const ran: string[] = [];
  const controller = new AbortController();
  const acts = actions(ran);
  acts[0]!.run = async () => {
    ran.push('list_tables');
    controller.abort();
    return [];
  };
  const gateway = scriptedGateway([[call('c1', 'list_tables'), call('c2', 'list_tables'), { type: 'done', reason: 'tool_calls' }], [{ type: 'done', reason: 'stop' }]]);
  const log = memoryLog();
  const result = await runAgent({ gateway, model: 'm', actions: acts, grants: defaultGrants, approve: async () => true, log }, [], controller.signal);
  assert.equal(result.outcome, 'stopped');
  assert.deepEqual(ran, ['list_tables']);
  assert.match(result.messages.find((m) => m.toolCallId === 'c2')!.content, /Cancelled/);
  assert.equal(gateway.requests.length, 1);
  assert.equal(log.entries().at(-1)!.kind, 'stop');
});

test('stopping mid-stream keeps what arrived in the log', async () => {
  const controller = new AbortController();
  const gateway = scriptedGateway([[{ type: 'text', text: 'Hal' }, { type: 'text', text: 'f' }, { type: 'done', reason: 'stop' }]]);
  const log = memoryLog();
  const result = await runAgent(
    { gateway, model: 'm', actions: [], grants: defaultGrants, approve: async () => true, log, onEvent: (e) => e.type === 'text' && controller.abort() },
    [],
    controller.signal,
  );
  assert.equal(result.outcome, 'stopped');
  assert.deepEqual(log.entries().find((e) => e.kind === 'response')!.data, { text: 'Hal', toolCalls: [], partial: true });
});

test('the step limit ends a run that never stops calling actions', async () => {
  const turn = () => [call('c', 'list_tables'), { type: 'done' as const, reason: 'tool_calls' }];
  const gateway = scriptedGateway([turn(), turn(), turn()]);
  const result = await runAgent({ gateway, model: 'm', actions: actions([]), grants: defaultGrants, approve: async () => true, log: memoryLog(), maxSteps: 3 }, []);
  assert.equal(result.outcome, 'limit');
  assert.equal(gateway.requests.length, 3);
});
