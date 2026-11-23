/**
 * The router (ADR 0043, section 2): the endpoints the user registered, and which endpoint and model each chat uses.
 * There is no hidden routing: a chat goes to the endpoint the user picked.
 */
import { endpoint, type Endpoint } from './endpoint.js';
import { SmaltaiError } from './errors.js';
import type { Log } from './log.js';
import { openaiGateway } from './openai.js';
import { memoryStore, readJson, type KeyValueStore } from './store.js';
import type { Fetch, Gateway } from './types.js';

/** The endpoint and model a chat uses. */
export interface Choice {
  endpointId: string;
  model: string;
}

/** Options for {@link createRouter}. */
export interface RouterOptions {
  /** Where endpoints and choices are remembered; in memory by default. */
  store?: KeyValueStore;
  /** The `fetch` the gateways use (always guarded). */
  fetch?: Fetch;
  /** Endpoint changes are logged here. */
  log?: Log;
  /** Prefix for the store's keys. */
  prefix?: string;
}

/** The router. */
export interface Router {
  endpoints(): Endpoint[];
  /** Adds or replaces an endpoint, checked by {@link endpoint}. */
  save(input: unknown): Endpoint;
  remove(id: string): void;
  gateway(id: string): Gateway;
  /** The choice remembered for a scope (an app, a report), if any. */
  choice(scope: string): Choice | null;
  choose(scope: string, choice: Choice): void;
}

export function createRouter(options: RouterOptions = {}): Router {
  const store = options.store ?? memoryStore();
  const prefix = options.prefix ?? 'smaltai';
  const endpointsKey = `${prefix}.endpoints`;
  const choiceKey = (scope: string) => `${prefix}.choice.${scope}`;

  // Endpoints read back from storage are checked again: an entry with a key field is refused, not used.
  function load(): Endpoint[] {
    const raw = readJson(store, endpointsKey);
    if (!Array.isArray(raw)) return [];
    const list: Endpoint[] = [];
    for (const item of raw) {
      try {
        list.push(endpoint(item));
      } catch (error) {
        options.log?.append('error', { what: 'stored endpoint refused', error });
      }
    }
    return list;
  }

  function write(list: Endpoint[]): void {
    store.setItem(endpointsKey, JSON.stringify(list));
  }

  return {
    endpoints: load,
    save(input) {
      const checked = endpoint(input);
      const list = load().filter((e) => e.id !== checked.id);
      list.push(checked);
      write(list);
      options.log?.append('grant', { change: 'endpoint saved', endpoint: checked });
      return checked;
    },
    remove(id) {
      write(load().filter((e) => e.id !== id));
      options.log?.append('grant', { change: 'endpoint removed', endpointId: id });
    },
    gateway(id) {
      const found = load().find((e) => e.id === id);
      if (found === undefined) throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', `No endpoint "${id}".`);
      const fetchOption = options.fetch === undefined ? {} : { fetch: options.fetch };
      switch (found.format) {
        case 'openai':
          return openaiGateway(found, fetchOption);
      }
    },
    choice(scope) {
      const raw = readJson(store, choiceKey(scope)) as Partial<Choice> | null;
      if (raw === null || typeof raw.endpointId !== 'string' || typeof raw.model !== 'string') return null;
      return { endpointId: raw.endpointId, model: raw.model };
    },
    choose(scope, choice) {
      store.setItem(choiceKey(scope), JSON.stringify({ endpointId: choice.endpointId, model: choice.model }));
    },
  };
}
