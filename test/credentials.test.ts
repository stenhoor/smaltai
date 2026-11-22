// The rule that comes first: smalt never sees or holds a key. These tests fail if smaltai's code sends a credential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { guardedFetch, isCredentialHeader, openaiGateway, SmaltaiError, type Fetch } from '@smaltworks/smaltai';
import { recordingFetch, sse, sseResponse } from './helpers.ts';

const ok: Fetch = async () => new Response('{}');

const refused = (code: string) => (error: unknown) => error instanceof SmaltaiError && error.code === code;

test('credential headers are refused before anything is sent', async () => {
  const { fetch, sent } = recordingFetch(() => new Response('{}'));
  const guarded = guardedFetch(fetch);
  for (const headers of [
    { Authorization: 'Bearer sk-x' },
    { 'x-api-key': 'k' },
    { 'Proxy-Authorization': 'Basic x' },
    { 'x-goog-api-key': 'k' },
    { cookie: 'a=b' },
    { 'anthropic-dangerous-direct-browser-access': 'true' },
    { 'X-Custom-Token': 't' },
  ] as Record<string, string>[]) {
    await assert.rejects(guarded('http://localhost:11434/v1/models', { headers }), refused('CREDENTIAL_REFUSED'));
  }
  await assert.rejects(guarded('http://localhost/x', { headers: new Headers({ authorization: 'x' }) }), refused('CREDENTIAL_REFUSED'));
  await assert.rejects(guarded('http://localhost/x', { headers: [['Authorization', 'x']] }), refused('CREDENTIAL_REFUSED'));
  assert.equal(sent.length, 0);
});

test('credentials in an address are refused', async () => {
  const guarded = guardedFetch(ok);
  await assert.rejects(guarded('http://user:pass@localhost/x', {}), refused('CREDENTIAL_REFUSED'));
  await assert.rejects(guarded('http://localhost/x?api_key=1', {}), refused('CREDENTIAL_REFUSED'));
  await assert.rejects(guarded('http://localhost/x?key=1', {}), refused('CREDENTIAL_REFUSED'));
});

test('every request omits credentials, whatever the caller asked', async () => {
  const { fetch, sent } = recordingFetch(() => new Response('{}'));
  await guardedFetch(fetch)('http://localhost/x', { credentials: 'include', headers: { 'content-type': 'application/json' } });
  assert.equal(sent[0]!.init.credentials, 'omit');
});

test('ordinary headers pass', () => {
  for (const name of ['content-type', 'accept', 'x-request-id', 'Keep-Alive']) assert.equal(isCredentialHeader(name), false, name);
});

test("the gateway's own requests carry no credential", async () => {
  const { fetch, sent } = recordingFetch((url) =>
    url.endsWith('/models') ? Response.json({ data: [{ id: 'm' }] }) : sseResponse(sse([{ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }])),
  );
  const gateway = openaiGateway({ id: 'o', name: 'Ollama', url: 'http://localhost:11434', format: 'openai' }, { fetch });
  for await (const _ of gateway.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));
  await gateway.models();
  assert.equal(sent.length, 2);
  for (const { init } of sent) {
    assert.equal(init.credentials, 'omit');
    for (const name of Object.keys((init.headers ?? {}) as Record<string, string>)) assert.equal(isCredentialHeader(name), false, name);
  }
});

test('no source file but the guard names a credential header', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const file of readdirSync(dir)) {
    if (file === 'credentials.ts') continue;
    const text = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(text, /authorization|x-api-key|api-key|bearer|credentials:\s*'(include|same-origin)'/i, file);
  }
});
