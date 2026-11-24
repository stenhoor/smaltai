/**
 * Checking a tool call against its action's input schema, before anything else happens to it (the owner, 2026-11-24):
 * a call whose input doesn't match goes back to the model as an error, so the user is never asked to approve it and the
 * app never runs it.
 *
 * smaltai checks a subset of JSON Schema, written here, and an action may use only that subset ({@link schemaProblem};
 * `checkActions` refuses any other keyword), so no rule an app declares goes unchecked:
 *
 * - `type`: `object`, `array`, `string`, `number`, `integer`, `boolean` or `null`, or a list of them;
 * - `enum` and `const`;
 * - for objects, `properties`, `required` and `additionalProperties` (`false`, or a schema the other properties match);
 * - for arrays, `items`, `minItems` and `maxItems`;
 * - for strings, `minLength`, `maxLength` and `pattern` (a JavaScript regular expression, with the `u` flag);
 * - for numbers, `minimum` and `maximum`;
 * - `anyOf`, a list of schemas the value matches one of;
 * - and the notes that check nothing: `title`, `description`, `default`, `examples`, `$comment`.
 */

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'] as const;
type JsonType = (typeof TYPES)[number];

/** The keywords smaltai checks, and the notes it ignores. */
export const SCHEMA_KEYWORDS: readonly string[] = [
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'anyOf',
  'title',
  'description',
  'default',
  'examples',
  '$comment',
];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Why a schema can't be checked by smaltai (a keyword outside its subset, or a malformed one), or `null`. */
export function schemaProblem(schema: unknown, path = 'inputSchema'): string | null {
  if (!isObject(schema)) return `${path} is not a schema object`;
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYWORDS.includes(key)) return `${path} uses "${key}", which smaltai doesn't check`;
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  for (const type of types) if (!TYPES.includes(type as JsonType)) return `${path}.type: "${String(type)}" isn't a JSON type`;
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) return `${path}.enum is not a list`;
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((r) => typeof r === 'string'))) return `${path}.required is not a list of names`;
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') return `${path}.pattern is not text`;
    try {
      new RegExp(schema.pattern, 'u');
    } catch {
      return `${path}.pattern is not a regular expression`;
    }
  }
  for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum'] as const) {
    if (schema[key] !== undefined && typeof schema[key] !== 'number') return `${path}.${key} is not a number`;
  }
  if (schema.properties !== undefined) {
    if (!isObject(schema.properties)) return `${path}.properties is not an object`;
    for (const [name, sub] of Object.entries(schema.properties)) {
      const problem = schemaProblem(sub, `${path}.properties.${name}`);
      if (problem !== null) return problem;
    }
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    const problem = schemaProblem(schema.additionalProperties, `${path}.additionalProperties`);
    if (problem !== null) return problem;
  }
  if (schema.items !== undefined) {
    const problem = schemaProblem(schema.items, `${path}.items`);
    if (problem !== null) return problem;
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || !schema.anyOf.length) return `${path}.anyOf is not a list of schemas`;
    for (const [i, sub] of schema.anyOf.entries()) {
      const problem = schemaProblem(sub, `${path}.anyOf[${i}]`);
      if (problem !== null) return problem;
    }
  }
  return null;
}

function typeOf(value: unknown): JsonType | 'other' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isFinite(value) ? (Number.isInteger(value) ? 'integer' : 'number') : 'other';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'object') return typeof value as JsonType;
  return 'other';
}

const show = (value: unknown): string => JSON.stringify(value) ?? String(value);
/** A type with its article: `a string`, `an object`, `null`. */
const named = (type: string): string => (type === 'null' ? 'null' : `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`);

/**
 * Why a value doesn't match a schema that passed {@link schemaProblem}, or `null`. The first problem found is given,
 * with where it is: `input.pages[0].name: expected a string, got a number`.
 */
export function inputProblem(schema: Record<string, unknown>, value: unknown, path = 'input'): string | null {
  if (schema.type !== undefined) {
    const types = (Array.isArray(schema.type) ? schema.type : [schema.type]) as JsonType[];
    const actual = typeOf(value);
    const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) return `${path}: expected ${types.map(named).join(' or ')}, got ${actual === 'other' ? 'something else' : named(actual === 'integer' ? 'number' : actual)}`;
  }
  if (schema.const !== undefined && show(schema.const) !== show(value)) return `${path}: expected ${show(schema.const)}`;
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => show(e) === show(value))) return `${path}: expected one of ${schema.enum.map(show).join(', ')}`;
  if (schema.anyOf !== undefined && !(schema.anyOf as Record<string, unknown>[]).some((sub) => inputProblem(sub, value, path) === null)) {
    return `${path}: matches none of the shapes it may have`;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) return `${path}: at least ${schema.minLength} characters`;
    if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) return `${path}: at most ${schema.maxLength} characters`;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) return `${path}: doesn't match ${schema.pattern}`;
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path}: at least ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path}: at most ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path}: at least ${schema.minItems} items`;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path}: at most ${schema.maxItems} items`;
    if (isObject(schema.items)) {
      for (const [i, item] of value.entries()) {
        const problem = inputProblem(schema.items, item, `${path}[${i}]`);
        if (problem !== null) return problem;
      }
    }
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const name of (schema.required as string[] | undefined) ?? []) if (!(name in value)) return `${path}: "${name}" is required`;
    for (const [name, item] of Object.entries(value)) {
      const sub = properties[name];
      if (isObject(sub)) {
        const problem = inputProblem(sub, item, `${path}.${name}`);
        if (problem !== null) return problem;
      } else if (schema.additionalProperties === false) {
        return `${path}.${name}: not allowed (no such property)`;
      } else if (isObject(schema.additionalProperties)) {
        const problem = inputProblem(schema.additionalProperties, item, `${path}.${name}`);
        if (problem !== null) return problem;
      }
    }
  }
  return null;
}
