/**
 * Endpoints: the gateways the user registers (ADR 0043, section 2). An endpoint is an address and a format, never a
 * key. The router knows several; the user picks one, and a model, for each chat.
 */
import { refuseCredentialUrl } from './credentials.js';
import { SmaltaiError } from './errors.js';

/** The formats smaltai speaks. `openai` is the chat completions API that Ollama, llama-server, LM Studio and LiteLLM serve. */
export type EndpointFormat = 'openai';

/** A gateway the user registered. */
export interface Endpoint {
  id: string;
  name: string;
  /** The gateway's base address, without `/v1`: `http://localhost:11434`. */
  url: string;
  format: EndpointFormat;
}

const FIELDS = new Set(['id', 'name', 'url', 'format']);
const FORMATS = new Set<string>(['openai']);

/**
 * Checks an endpoint as entered or as read back from storage, and returns it normalized. Throws `SMALTAI_ENDPOINT_INVALID` for
 * a missing or unknown field (there is no place for a key), and `SMALTAI_CREDENTIAL_REFUSED` for an address that carries a user
 * name, password or credential parameter.
 */
export function endpoint(input: unknown): Endpoint {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', 'An endpoint is an object with id, name, url and format.');
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!FIELDS.has(key)) {
      throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', `An endpoint has no field "${key}": only id, name, url and format. Keys belong in your gateway.`);
    }
  }
  const { id, name, url, format } = record;
  if (typeof id !== 'string' || id === '') throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', 'An endpoint needs an id.');
  if (typeof name !== 'string' || name === '') throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', 'An endpoint needs a name.');
  if (typeof format !== 'string' || !FORMATS.has(format)) {
    throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', `An endpoint's format is one of: ${[...FORMATS].join(', ')}.`);
  }
  if (typeof url !== 'string') throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', 'An endpoint needs a url.');
  return { id, name, url: baseUrl(url), format: format as EndpointFormat };
}

/** Normalizes a gateway address: http or https only, no credentials, no query or fragment, no trailing `/` or `/v1`. */
export function baseUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', `Not an address: ${text}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', 'A gateway address starts with http:// or https://.');
  }
  refuseCredentialUrl(url);
  if (url.search !== '' || url.hash !== '') {
    throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', 'A gateway address has no query or fragment.');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/v1')) path = path.slice(0, -3);
  return `${url.origin}${path}`;
}
