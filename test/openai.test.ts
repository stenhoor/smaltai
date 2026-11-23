import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openaiBody, openaiGateway, SmaltaiError, type StreamEvent } from '@smaltworks/smaltai';
import { recordingFetch, sse, sseResponse, streamOf } from './helpers.ts';

const ep = { id: 'o', name: 'Ollama', url: 'http://localhost:11434', format: 'openai' as const };
const code = (c: string) => (e: unknown) => e instanceof SmaltaiError && e.code === c;

async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

test('streams text, then usage, then done', async () => {
  const { fetch, sent } = recordingFetch(() =>
    sseResponse(
      sse([
        { choices: [{ delta: { role: 'assistant', content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 2 } },
      ]),
    ),
  );
  const events = await collect(openaiGateway(ep, { fetch }).chat({ model: 'qwen', messages: [{ role: 'user', content: 'hi' }] }));
  assert.deepEqual(events, [
    { type: 'text', text: 'Hel' },
    { type: 'text', text: 'lo' },
    { type: 'usage', usage: { inputTokens: 12, outputTokens: 2 } },
    { type: 'done', reason: 'stop' },
  ]);
  assert.equal(sent[0]!.url, 'http://localhost:11434/v1/chat/completions');
  const body = JSON.parse(sent[0]!.init.body as string);
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test('assembles tool calls from their deltas, each handed on when the next starts', async () => {
  const { fetch } = recordingFetch(() =>
    sseResponse(
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'run_query', arguments: '' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"sql":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"select 1"}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'list_tables', arguments: '{}' } }] } }] },
        { choices: [{ delta: { content: 'thinking' } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]),
    ),
  );
  const events = await collect(openaiGateway(ep, { fetch }).chat({ model: 'm', messages: [] }));
  assert.deepEqual(events, [
    { type: 'tool_call', call: { id: 'c1', name: 'run_query', arguments: { sql: 'select 1' } } },
    { type: 'text', text: 'thinking' },
    { type: 'tool_call', call: { id: 'c2', name: 'list_tables', arguments: {} } },
    { type: 'done', reason: 'tool_calls' },
  ]);
});

test('a stream that goes back to a call already handed on is refused', async () => {
  const { fetch } = recordingFetch(() =>
    sseResponse(
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'g', arguments: '{}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] },
      ]),
    ),
  );
  await assert.rejects(collect(openaiGateway(ep, { fetch }).chat({ model: 'm', messages: [] })), code('SMALTAI_STREAM_INVALID'));
});

test('arguments that are not JSON are kept as text', async () => {
  const { fetch } = recordingFetch(() =>
    sseResponse(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'f', arguments: '{oops' } }] }, finish_reason: 'tool_calls' }] }])),
  );
  const events = await collect(openaiGateway(ep, { fetch }).chat({ model: 'm', messages: [] }));
  assert.deepEqual(events[0], { type: 'tool_call', call: { id: 'c', name: 'f', arguments: '{oops' } });
});

test('the request body: messages, tool calls and tools in the wire format', () => {
  const body = openaiBody({
    model: 'm',
    messages: [
      { role: 'system', content: 's' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'f', arguments: { a: 1 } }] },
      { role: 'tool', toolCallId: 'c', content: 'r' },
    ],
    tools: [{ name: 'f', description: 'd', inputSchema: { type: 'object' } }],
  });
  assert.deepEqual(body.messages, [
    { role: 'system', content: 's' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] },
    { role: 'tool', tool_call_id: 'c', content: 'r' },
  ]);
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }]);
});

test('an error status becomes GATEWAY_ERROR with the status', async () => {
  const { fetch } = recordingFetch(() => new Response('model not found', { status: 404 }));
  await assert.rejects(collect(openaiGateway(ep, { fetch }).chat({ model: 'x', messages: [] })), (e: unknown) => {
    return e instanceof SmaltaiError && e.code === 'SMALTAI_GATEWAY_ERROR' && e.status === 404 && /model not found/.test(e.message);
  });
});

test('an error inside the stream becomes GATEWAY_ERROR', async () => {
  const { fetch } = recordingFetch(() => sseResponse(['data: {"error":{"message":"overloaded"}}\n\n']));
  await assert.rejects(collect(openaiGateway(ep, { fetch }).chat({ model: 'x', messages: [] })), code('SMALTAI_GATEWAY_ERROR'));
});

test('a refused connection becomes GATEWAY_UNREACHABLE', async () => {
  const fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(collect(openaiGateway(ep, { fetch }).chat({ model: 'x', messages: [] })), code('SMALTAI_GATEWAY_UNREACHABLE'));
});

test('an event that is not JSON becomes STREAM_INVALID', async () => {
  const { fetch } = recordingFetch(() => sseResponse(['data: {nope\n\n']));
  await assert.rejects(collect(openaiGateway(ep, { fetch }).chat({ model: 'x', messages: [] })), code('SMALTAI_STREAM_INVALID'));
});

test('the signal stops a stream mid-way', async () => {
  const controller = new AbortController();
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`));
    },
  });
  const fetch = async () => new Response(body);
  const seen: StreamEvent[] = [];
  await assert.rejects(
    (async () => {
      for await (const e of openaiGateway(ep, { fetch }).chat({ model: 'x', messages: [], signal: controller.signal })) {
        seen.push(e);
        if (seen.length === 3) controller.abort();
      }
    })(),
    code('SMALTAI_ABORTED'),
  );
  assert.equal(seen.length, 3);
  assert.ok(pulls < 10);
});

test('models are listed', async () => {
  const { fetch, sent } = recordingFetch(() => Response.json({ object: 'list', data: [{ id: 'qwen3' }, { id: 'llama3.2' }, { bad: 1 }] }));
  assert.deepEqual(await openaiGateway(ep, { fetch }).models(), [{ id: 'qwen3' }, { id: 'llama3.2' }]);
  assert.equal(sent[0]!.url, 'http://localhost:11434/v1/models');
});

test('describe gives what a request sends', () => {
  const d = openaiGateway(ep).describe!({ model: 'm', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(d.url, 'http://localhost:11434/v1/chat/completions');
  assert.deepEqual((d.body as { messages: unknown }).messages, [{ role: 'user', content: 'q' }]);
  void streamOf;
});
