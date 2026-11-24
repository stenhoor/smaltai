import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputProblem, schemaProblem } from '@smaltworks/smaltai';

const page = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 40 },
    kind: { enum: ['report', 'tooltip'] },
    rows: { type: 'integer', minimum: 1, maximum: 60 },
    size: { anyOf: [{ type: 'null' }, { type: 'object', properties: { preset: { const: 'a4' } }, required: ['preset'], additionalProperties: false }] },
    fields: { type: 'array', items: { type: 'string', pattern: '^[a-z_]+\\.[A-Za-z ]+$' }, minItems: 1, maxItems: 3 },
    weight: { type: ['number', 'null'] },
  },
  required: ['name'],
  additionalProperties: false,
};

test('a value that matches its schema has no problem', () => {
  assert.equal(schemaProblem(page), null);
  assert.equal(inputProblem(page, { name: 'Overview' }), null);
  assert.equal(inputProblem(page, { name: 'Overview', kind: 'tooltip', rows: 30, size: { preset: 'a4' }, fields: ['sales.Revenue'], weight: 1.5 }), null);
  assert.equal(inputProblem(page, { name: 'Overview', size: null, weight: null }), null);
  assert.equal(inputProblem({ type: 'object' }, { anything: [1, 'two'] }), null, 'no properties: any object');
});

test('the first problem is given, with where it is', () => {
  const cases: [unknown, string][] = [
    ['Overview', 'input: expected an object, got a string'],
    [{}, 'input: "name" is required'],
    [{ name: 7 }, 'input.name: expected a string, got a number'],
    [{ name: '' }, 'input.name: at least 1 characters'],
    [{ name: 'x'.repeat(41) }, 'input.name: at most 40 characters'],
    [{ name: 'A', kind: 'page' }, 'input.kind: expected one of "report", "tooltip"'],
    [{ name: 'A', rows: 2.5 }, 'input.rows: expected an integer, got a number'],
    [{ name: 'A', rows: 61 }, 'input.rows: at most 60'],
    [{ name: 'A', size: { preset: 'letter' } }, 'input.size: matches none of the shapes it may have'],
    [{ name: 'A', fields: [] }, 'input.fields: at least 1 items'],
    [{ name: 'A', fields: ['sales.Revenue', 'Revenue'] }, 'input.fields[1]: doesn\'t match ^[a-z_]+\\.[A-Za-z ]+$'],
    [{ name: 'A', weight: 'heavy' }, 'input.weight: expected a number or null, got a string'],
    [{ name: 'A', colour: 'red' }, 'input.colour: not allowed (no such property)'],
  ];
  for (const [value, problem] of cases) assert.equal(inputProblem(page, value), problem, JSON.stringify(value));
});

test('additionalProperties as a schema checks the other properties', () => {
  const map = { type: 'object', additionalProperties: { type: 'boolean' } };
  assert.equal(inputProblem(map, { a: true, b: false }), null);
  assert.equal(inputProblem(map, { a: 'yes' }), 'input.a: expected a boolean, got a string');
});

test('a schema that uses what smaltai does not check is refused, so no rule goes unchecked', () => {
  assert.equal(schemaProblem({ type: 'object', oneOf: [] }), 'inputSchema uses "oneOf", which smaltai doesn\'t check');
  assert.equal(schemaProblem({ type: 'object', properties: { x: { type: 'string', format: 'email' } } }), 'inputSchema.properties.x uses "format", which smaltai doesn\'t check');
  assert.equal(schemaProblem({ type: 'text' }), 'inputSchema.type: "text" isn\'t a JSON type');
  assert.equal(schemaProblem({ type: 'string', pattern: '(' }), 'inputSchema.pattern is not a regular expression');
  assert.equal(schemaProblem({ type: 'array', items: { type: 'object', required: 'name' } }), 'inputSchema.items.required is not a list of names');
  assert.equal(schemaProblem({ type: 'object', title: 'Page', description: 'A page.', default: {}, examples: [], $comment: 'notes' }), null, 'notes are allowed');
});
