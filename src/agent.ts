/**
 * The agent: a model working through an app's own actions (ADR 0025, ADR 0043 section 7).
 *
 * Each step sends the conversation and the actions (as tools) to the gateway and streams the answer back. Each action
 * the model calls starts as soon as its call is complete, while the answer still streams (ADR 0025 section 7), one at a
 * time in the order called. Grants decide what runs without asking ({@link decide}); the rest waits for the user, who
 * may allow it once or grant it (ADR 0025 section 5). Results go back to the model marked as data ({@link asData});
 * smaltai's own notes (declined, cancelled, unknown action) go as plain text. Everything is logged, with smaltai's own
 * time per step (ADR 0025 section 7). The signal is the kill switch: it stops the stream and cancels the actions not
 * yet run (ADR 0043 section 6).
 *
 * The agent has no way to change grants: it only reads them. A grant given from a question goes to the app's
 * `onGrant`, which the app handles as the user's own change (DECISIONS.md, 2026-11-23).
 */
import { asData, DATA_RULE } from './defences.js';
import { SmaltaiError } from './errors.js';
import { decide, type ActionPolicy, type Grants } from './grants.js';
import type { Log } from './log.js';
import type { Gateway, Message, ToolCall, ToolSpec, Usage } from './types.js';

/** The step limit's starting value; the user sets their own (DECISIONS.md, 2026-11-23). */
export const DEFAULT_MAX_STEPS = 20;

/**
 * An action the app offers: its policy for grants, its tool description, the shape of its result (ADR 0025 section 4),
 * and how to run it.
 */
export interface Action extends ActionPolicy, ToolSpec {
  /** A JSON Schema object for what `run` returns. */
  resultSchema: Record<string, unknown>;
  run(input: Record<string, unknown>, context: { signal: AbortSignal }): Promise<unknown>;
}

/**
 * Checks an app's actions: each has a name used once, a description, an input and a result schema that are JSON
 * Schema objects, a kind, what it touches and whether it can be undone. ADR 0025 section 6: a test fails if an action
 * has no description or input schema; an app's tests call this. `runAgent` calls it too. Throws
 * `SMALTAI_ACTION_INVALID`.
 */
export function checkActions(actions: readonly Action[]): void {
  const fail = (why: string): never => {
    throw new SmaltaiError('SMALTAI_ACTION_INVALID', why);
  };
  const seen = new Set<string>();
  for (const action of actions) {
    const name = typeof action.name === 'string' ? action.name : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) fail(`An action's name is 1 to 64 letters, digits, _ or -: ${JSON.stringify(action.name)}`);
    if (seen.has(name)) fail(`Two actions are named "${name}".`);
    seen.add(name);
    if (typeof action.description !== 'string' || action.description.trim() === '') fail(`"${name}" has no description.`);
    for (const key of ['inputSchema', 'resultSchema'] as const) {
      const schema = action[key];
      if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) fail(`"${name}" has no ${key}.`);
    }
    if (action.inputSchema.type !== 'object') fail(`"${name}": its inputSchema's type is "object".`);
    if (action.kind !== 'read' && action.kind !== 'write') fail(`"${name}": its kind is "read" or "write".`);
    if (typeof action.touches !== 'object' || action.touches === null || typeof action.touches.rows !== 'boolean') {
      fail(`"${name}" doesn't say what it touches.`);
    }
    if (typeof action.undoable !== 'boolean') fail(`"${name}" doesn't say whether it can be undone.`);
    if (typeof action.run !== 'function') fail(`"${name}" has no run.`);
  }
}

/** What the user is asked before an action outside the grants runs. */
export interface ApprovalRequest {
  action: string;
  input: Record<string, unknown>;
  reason: string;
  /** Whether "grant" may be offered as well as "once" (not for configuration tables or a data level). */
  grantable: boolean;
  /** False for an action that can't be undone, to say so. */
  undoable: boolean;
}

/** The user's answer: run it this once, grant the action from now on, or decline. */
export type Approval = 'once' | 'grant' | 'decline';

/** What the agent reports while it works, for the chat panel. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'action'; call: ToolCall; verdict: 'allow' | Approval }
  | { type: 'result'; call: ToolCall; ok: boolean; ms: number }
  | { type: 'usage'; step: Usage; total: Usage };

export interface AgentOptions {
  gateway: Gateway;
  model: string;
  actions: Action[];
  /** The grants in force, read before every call, so a change or a revoke takes effect at once. */
  grants: () => Grants;
  /** Asks the user. */
  approve: (request: ApprovalRequest) => Promise<Approval>;
  /** Called when the user answers "grant": the app records it in its grants, as the user's own change. */
  onGrant?: (action: string) => void;
  log: Log;
  /** The app's own instructions, before the data rule. */
  system?: string;
  /** Model turns before the agent stops: the user's setting, {@link DEFAULT_MAX_STEPS} if none. */
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
}

/** smaltai's own time, in milliseconds (ADR 0025 section 7): building each request, and running each action. */
export interface Timings {
  buildMs: number[];
  actionMs: number[];
}

export interface AgentResult {
  /** The conversation, including what this run added. */
  messages: Message[];
  usage: Usage;
  timings: Timings;
  /** `done`: the model finished. `stopped`: the kill switch. `limit`: the step limit reached. */
  outcome: 'done' | 'stopped' | 'limit';
}

const CANCELLED = 'Cancelled: the user stopped the agent.';

/** Runs the agent on a conversation until the model answers without asking for actions, is stopped, or hits the limit. */
export async function runAgent(options: AgentOptions, history: Message[], signal?: AbortSignal): Promise<AgentResult> {
  checkActions(options.actions);
  const { gateway, model, log } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted === true) controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const byName = new Map(options.actions.map((action) => [action.name, action]));
  const tools: ToolSpec[] = options.actions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const system = [options.system, DATA_RULE].filter((part) => part !== undefined && part !== '').join('\n\n');
  const messages: Message[] = history[0]?.role === 'system' ? [...history] : [{ role: 'system', content: system }, ...history];
  const total: Usage = { inputTokens: 0, outputTokens: 0 };
  const timings: Timings = { buildMs: [], actionMs: [] };
  const emit = (event: AgentEvent) => options.onEvent?.(event);
  const result = (outcome: AgentResult['outcome']): AgentResult => ({ messages, usage: total, timings, outcome });
  const stopped = (): AgentResult => {
    log.append('stop', { reason: 'stopped by the user' });
    return result('stopped');
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (controller.signal.aborted) return stopped();
      const built = performance.now();
      const request = { model, messages: [...messages], tools, signal: controller.signal };
      // Exactly what leaves the browser, where the gateway can say (ADR 0043, section 5).
      const sent = gateway.describe?.(request) ?? { model, messages, tools };
      const buildMs = performance.now() - built;
      timings.buildMs.push(buildMs);
      log.append('request', { ...sent, buildMs });

      let text = '';
      const calls: ToolCall[] = [];
      const answers: Promise<string>[] = [];
      let queue: Promise<unknown> = Promise.resolve();
      let usage: Usage | undefined;
      let reason = '';
      try {
        for await (const event of gateway.chat(request)) {
          if (event.type === 'text') {
            text += event.text;
            emit({ type: 'text', text: event.text });
          } else if (event.type === 'tool_call') {
            // Start it now, after the calls before it.
            const call = event.call;
            calls.push(call);
            const answer = queue.then(() => runCall(call));
            answers.push(answer);
            queue = answer;
          } else if (event.type === 'usage') usage = event.usage;
          else reason = event.reason;
        }
      } catch (error) {
        const aborted = controller.signal.aborted || (error instanceof SmaltaiError && error.code === 'SMALTAI_ABORTED');
        if (aborted) controller.abort();
        // Let the actions already started finish or cancel, so the log is complete.
        const settled = await Promise.allSettled(answers);
        if (aborted) {
          log.append('response', { text, toolCalls: calls, partial: true });
          // Keep what the model said and an answer for each call it made, so the conversation can go on later.
          messages.push(calls.length > 0 ? { role: 'assistant', content: text, toolCalls: calls } : { role: 'assistant', content: text });
          calls.forEach((call, i) => {
            const outcome = settled[i]!;
            messages.push({ role: 'tool', toolCallId: call.id, content: outcome.status === 'fulfilled' ? outcome.value : CANCELLED });
          });
          return stopped();
        }
        log.append('error', { during: 'request', error });
        throw error;
      }
      log.append('response', { text, toolCalls: calls, usage: usage ?? null, reason });
      if (usage !== undefined) {
        total.inputTokens += usage.inputTokens;
        total.outputTokens += usage.outputTokens;
        emit({ type: 'usage', step: usage, total: { ...total } });
      }
      messages.push(calls.length > 0 ? { role: 'assistant', content: text, toolCalls: calls } : { role: 'assistant', content: text });
      if (calls.length === 0) return result('done');
      // The model gets an answer for each call it made, cancelled ones included, so the conversation stays valid.
      const contents = await Promise.all(answers);
      calls.forEach((call, i) => messages.push({ role: 'tool', toolCallId: call.id, content: contents[i]! }));
      if (controller.signal.aborted) return stopped();
    }
    log.append('stop', { reason: 'step limit', maxSteps });
    return result('limit');
  } finally {
    signal?.removeEventListener('abort', stop);
  }

  async function runCall(call: ToolCall): Promise<string> {
    if (controller.signal.aborted) {
      log.append('result', { call, cancelled: true });
      return CANCELLED;
    }
    const action = byName.get(call.name);
    if (action === undefined) {
      log.append('action', { call, refused: 'unknown action' });
      return `Error: there is no action ${JSON.stringify(call.name)}.`;
    }
    if (typeof call.arguments !== 'object' || call.arguments === null || Array.isArray(call.arguments)) {
      log.append('action', { call, refused: 'arguments are not an object' });
      return 'Error: the arguments must be a JSON object.';
    }
    const input = call.arguments as Record<string, unknown>;
    const decision = decide(options.grants(), action, input);
    let verdict: 'allow' | Approval = 'allow';
    if (decision.verdict === 'ask') {
      const answer = await options.approve({ action: action.name, input, reason: decision.reason, grantable: decision.grantable, undoable: action.undoable });
      // A "grant" the question didn't offer counts as once.
      verdict = answer === 'grant' && !decision.grantable ? 'once' : answer;
      log.append('approval', { call, reason: decision.reason, answer: verdict });
      if (verdict === 'grant') options.onGrant?.(action.name);
    }
    emit({ type: 'action', call, verdict });
    if (verdict === 'decline') return 'The user declined this action.';
    if (controller.signal.aborted) {
      log.append('result', { call, cancelled: true });
      return CANCELLED;
    }
    log.append('action', { call, verdict });
    const started = performance.now();
    try {
      const value = await action.run(input, { signal: controller.signal });
      const ms = performance.now() - started;
      timings.actionMs.push(ms);
      log.append('result', { call, ok: true, result: value, ms });
      emit({ type: 'result', call, ok: true, ms });
      return asData(action.name, value);
    } catch (error) {
      const ms = performance.now() - started;
      timings.actionMs.push(ms);
      log.append('result', { call, ok: false, error, ms });
      emit({ type: 'result', call, ok: false, ms });
      return asData(action.name, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
