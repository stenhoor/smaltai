/**
 * The rule that comes first: smalt never sees or holds a key (ADR 0025 section 3, ADR 0043 section 1).
 *
 * Every request smaltai makes goes through {@link guardedFetch}. It refuses any header that carries a credential and
 * sends no cookies or HTTP authentication (`credentials: 'omit'`). A key belongs in the user's own gateway, which adds
 * it to the request it forwards.
 */
import { SmaltaiError } from './errors.js';
import type { Fetch } from './types.js';

/** Header names that carry credentials. Compared in lower case. */
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'anthropic-dangerous-direct-browser-access',
  'openai-organization',
  'openai-project',
]);

/** True if a header name would carry a credential: the list above, or any name mentioning a key, token, secret or password. */
export function isCredentialHeader(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (CREDENTIAL_HEADERS.has(n)) return true;
  return /(^|[-_])(api[-_]?key|key|token|secret|password|auth)([-_]|$)/.test(n);
}

/** Query parameter names that carry credentials. */
export function isCredentialParam(name: string): boolean {
  return /^(api[-_]?key|key|token|access[-_]?token|secret|password|auth|sig|signature)$/i.test(name.trim());
}

function headerNames(headers: HeadersInit | undefined): string[] {
  if (headers === undefined) return [];
  if (headers instanceof Headers) return [...headers.keys()];
  if (Array.isArray(headers)) return headers.map(([name]) => name);
  return Object.keys(headers);
}

/** Throws `CREDENTIAL_REFUSED` if a URL carries a user name, a password or a credential parameter. */
export function refuseCredentialUrl(url: URL): void {
  if (url.username !== '' || url.password !== '') {
    throw new SmaltaiError('CREDENTIAL_REFUSED', 'An address may not carry a user name or password: put the key in your gateway.');
  }
  for (const name of url.searchParams.keys()) {
    if (isCredentialParam(name)) {
      throw new SmaltaiError('CREDENTIAL_REFUSED', `An address may not carry a credential parameter (${name}): put the key in your gateway.`);
    }
  }
}

/**
 * Wraps a `fetch` so that no request carries a credential. Throws `CREDENTIAL_REFUSED` before anything is sent if a
 * header or the address would carry one, and always sends `credentials: 'omit'`.
 */
export function guardedFetch(fetchImpl: Fetch): Fetch {
  return async (input, init) => {
    refuseCredentialUrl(new URL(input));
    for (const name of headerNames(init.headers)) {
      if (isCredentialHeader(name)) {
        throw new SmaltaiError('CREDENTIAL_REFUSED', `smaltai never sends a credential header (${name}): put the key in your gateway.`);
      }
    }
    return fetchImpl(input, { ...init, credentials: 'omit' });
  };
}
