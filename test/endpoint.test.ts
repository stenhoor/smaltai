import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseUrl, createRouter, endpoint, memoryStore, memoryLog, SmaltaiError } from '@smaltworks/smaltai';

const code = (c: string) => (e: unknown) => e instanceof SmaltaiError && e.code === c;

test('an endpoint is an address and a format', () => {
  assert.deepEqual(endpoint({ id: 'o', name: 'Ollama', url: 'http://localhost:11434/v1/', format: 'openai' }), {
    id: 'o',
    name: 'Ollama',
    url: 'http://localhost:11434',
    format: 'openai',
  });
  assert.equal(baseUrl('https://gw.example.net/litellm/v1'), 'https://gw.example.net/litellm');
});

test('an endpoint has no place for a key', () => {
  assert.throws(() => endpoint({ id: 'o', name: 'O', url: 'http://localhost', format: 'openai', apiKey: 'sk-x' }), code('SMALTAI_ENDPOINT_INVALID'));
  assert.throws(() => endpoint({ id: 'o', name: 'O', url: 'http://u:p@localhost', format: 'openai' }), code('SMALTAI_CREDENTIAL_REFUSED'));
  assert.throws(() => endpoint({ id: 'o', name: 'O', url: 'http://localhost?token=x', format: 'openai' }), code('SMALTAI_CREDENTIAL_REFUSED'));
});

test('bad endpoints are refused', () => {
  assert.throws(() => endpoint({ id: 'o', name: 'O', url: 'ftp://localhost', format: 'openai' }), code('SMALTAI_ENDPOINT_INVALID'));
  assert.throws(() => endpoint({ id: 'o', name: 'O', url: 'not a url', format: 'openai' }), code('SMALTAI_ENDPOINT_INVALID'));
  assert.throws(() => endpoint({ id: 'o', name: 'O', url: 'http://localhost', format: 'anthropic' }), code('SMALTAI_ENDPOINT_INVALID'));
  assert.throws(() => endpoint({ id: '', name: 'O', url: 'http://localhost', format: 'openai' }), code('SMALTAI_ENDPOINT_INVALID'));
});

test('the router remembers endpoints and choices', async () => {
  const store = memoryStore();
  const log = memoryLog();
  const router = createRouter({ store, log });
  await router.save({ id: 'o', name: 'Ollama', url: 'http://localhost:11434', format: 'openai' });
  await router.save({ id: 'l', name: 'llama-server', url: 'http://127.0.0.1:8080', format: 'openai' });
  await router.choose('smaltbi', { endpointId: 'l', model: 'qwen' });
  const again = createRouter({ store });
  assert.deepEqual((await again.endpoints()).map((e) => e.id), ['o', 'l']);
  assert.deepEqual(await again.choice('smaltbi'), { endpointId: 'l', model: 'qwen' });
  assert.equal(await again.choice('smaltnb'), null);
  await again.remove('o');
  assert.deepEqual((await again.endpoints()).map((e) => e.id), ['l']);
  await assert.rejects(again.gateway('o'), code('SMALTAI_ENDPOINT_INVALID'));
  assert.equal(typeof (await again.gateway('l')).chat, 'function');
  assert.equal((await log.entries()).length, 2);
});

test('saves made at the same time are all kept', async () => {
  const router = createRouter();
  await Promise.all(['a', 'b', 'c', 'd'].map((id) => router.save({ id, name: id, url: 'http://localhost', format: 'openai' })));
  assert.deepEqual((await router.endpoints()).map((e) => e.id).sort(), ['a', 'b', 'c', 'd']);
});

test('an invalid endpoint is refused before anything is stored', async () => {
  const router = createRouter();
  await assert.rejects(router.save({ id: 'x', name: 'X', url: 'http://localhost', format: 'openai', apiKey: 'sk' }), code('SMALTAI_ENDPOINT_INVALID'));
  assert.deepEqual(await router.endpoints(), []);
});

test('a stored endpoint with a key is refused when read back', async () => {
  const store = memoryStore();
  await store.setItem('smaltai.endpoints', JSON.stringify([{ id: 'x', name: 'X', url: 'http://localhost', format: 'openai', apiKey: 'sk' }]));
  const log = memoryLog();
  assert.deepEqual(await createRouter({ store, log }).endpoints(), []);
  assert.equal((await log.entries())[0]!.kind, 'error');
});
