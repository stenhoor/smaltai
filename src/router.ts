/**
 * The router (ADR 0043, section 2): the endpoints the user registered, and which endpoint and model each chat uses.
 * There is no hidden routing: a chat goes to the endpoint the user picked.
 */
import { endpoint, type Endpoint } from './endpoint.js';
import { SmaltaiError } from './errors.js';
import type { Log } from './log.js';
import { openaiGateway } from './openai.js';
import type { Fetch, Gateway } from './types.js';

/** The endpoint and model a chat uses. */
export interface Choice {
  endpointId: string;
  model: string;
}

/**
 * Where the router keeps endpoints and choices: in memory ({@link memoryRouterStore}), or in smaltai's own database
 * through smaltts (`@smaltworks/smaltai/store`). Endpoints come back as they were stored, and the router checks each
 * again.
 */
export interface RouterStore {
  endpoints(): Promise<unknown[]>;
  putEndpoint(endpoint: Endpoint): Promise<void>;
  deleteEndpoint(id: string): Promise<void>;
  /** The stored choice for a scope, or `null`. */
  choice(scope: string): Promise<unknown>;
  putChoice(scope: string, choice: Choice): Promise<void>;
}

/** A router store in memory. */
export function memoryRouterStore(): RouterStore {
  const endpoints = new Map<string, Endpoint>();
  const choices = new Map<string, Choice>();
  return {
    endpoints: async () => [...endpoints.values()].map((e) => ({ ...e })),
    putEndpoint: async (e) => void endpoints.set(e.id, { ...e }),
    deleteEndpoint: async (id) => void endpoints.delete(id),
    choice: async (scope) => {
      const c = choices.get(scope);
      return c === undefined ? null : { ...c };
    },
    putChoice: async (scope, c) => void choices.set(scope, { endpointId: c.endpointId, model: c.model }),
  };
}

/** Options for {@link createRouter}. */
export interface RouterOptions {
  /** Where endpoints and choices are remembered; in memory by default. */
  store?: RouterStore;
  /** The `fetch` the gateways use (always guarded). */
  fetch?: Fetch;
  /** Endpoint changes are logged here. */
  log?: Log;
}

/** The router. Asynchronous, as its store is (DECISIONS.md, 2026-11-23: "smaltai's storage"). */
export interface Router {
  /** The endpoints, in the order of their ids. */
  endpoints(): Promise<Endpoint[]>;
  /** Adds or replaces an endpoint, checked by {@link endpoint}. */
  save(input: unknown): Promise<Endpoint>;
  remove(id: string): Promise<void>;
  gateway(id: string): Promise<Gateway>;
  /** The choice remembered for a scope (an app, a report), if any. */
  choice(scope: string): Promise<Choice | null>;
  choose(scope: string, choice: Choice): Promise<void>;
}

export function createRouter(options: RouterOptions = {}): Router {
  const store = options.store ?? memoryRouterStore();

  // Endpoints read back from storage are checked again: an entry with a key field is refused, not used.
  async function load(): Promise<Endpoint[]> {
    const list: Endpoint[] = [];
    for (const item of await store.endpoints()) {
      try {
        list.push(endpoint(item));
      } catch (error) {
        await options.log?.append('error', { what: 'stored endpoint refused', error });
      }
    }
    return list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  return {
    endpoints: load,
    async save(input) {
      const checked = endpoint(input);
      await store.putEndpoint(checked);
      await options.log?.append('grant', { change: 'endpoint saved', endpoint: checked });
      return checked;
    },
    async remove(id) {
      await store.deleteEndpoint(id);
      await options.log?.append('grant', { change: 'endpoint removed', endpointId: id });
    },
    async gateway(id) {
      const found = (await load()).find((e) => e.id === id);
      if (found === undefined) throw new SmaltaiError('SMALTAI_ENDPOINT_INVALID', `No endpoint "${id}".`);
      const fetchOption = options.fetch === undefined ? {} : { fetch: options.fetch };
      switch (found.format) {
        case 'openai':
          return openaiGateway(found, fetchOption);
      }
    },
    async choice(scope) {
      const raw = (await store.choice(scope)) as Partial<Choice> | null;
      if (raw === null || typeof raw !== 'object' || typeof raw.endpointId !== 'string' || typeof raw.model !== 'string') return null;
      return { endpointId: raw.endpointId, model: raw.model };
    },
    async choose(scope, choice) {
      await store.putChoice(scope, { endpointId: choice.endpointId, model: choice.model });
    },
  };
}
