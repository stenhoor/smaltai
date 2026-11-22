import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseData } from '@smaltworks/smaltai';
import { streamOf } from './helpers.ts';

async function all(chunks: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (const data of sseData(streamOf(chunks))) out.push(data);
  return out;
}

test('events split across chunks', async () => {
  assert.deepEqual(await all(['data: {"a"', ':1}\n', '\ndata: two\n\n']), ['{"a":1}', 'two']);
});

test('CRLF, CR and LF endings, including CRLF split between chunks', async () => {
  assert.deepEqual(await all(['data: a\r', '\n\r\ndata: b\r\rdata: c\n\n']), ['a', 'b', 'c']);
});

test('multi-line data, comments and other fields', async () => {
  assert.deepEqual(await all([': ping\nevent: x\ndata: one\ndata:two\nid: 3\n\n']), ['one\ntwo']);
});

test('a last event without a blank line', async () => {
  assert.deepEqual(await all(['data: last']), ['last']);
});
