/**
 * The agent: a model working through an app's own actions (ADR 0025, ADR 0043 section 7).
 *
 * Each step sends the conversation and the actions (as tools) to the gateway, streams the answer back, and runs the
 * actions the model asked for. Grants decide what runs without asking ({@link decide}); the rest waits for the user's
 * approval. Results go back to the model marked as data ({@link asData}); smaltai's own notes (declined, cancelled,
 * unknown action) go as plain text. Everything is logged. The signal is the kill
 * switch: it stops the stream and cancels the actions not yet run.
 */
import { asData, DATA_RULE } from './defences.js';
import { SmaltaiError } from './errors.js';
import { decide, type ActionPolicy, type Grants } from './grants.js';
import type { Log } from './log.js';
import type { Gateway, Message, ToolCall, ToolSpec, Usage } from './types.js';

/** An action the app offers: its policy for grants, its tool description, and how to run it. */
export interface Action extends ActionPolicy, ToolSpec {
  run(input: Record<string, unknown>, context: { signal: AbortSignal }): Promise<unknown>;
}

/** What the user is asked before an action outside the grants runs. */
export interface ApprovalRequest {
  action: string;
  input: Record<string, unknown>;
  reason: string;
}

/** What the agent reports while it works, for the chat panel. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'action'; call: ToolCall; verdict: 'allow' | 'approved' | 'declined' }
  | { type: 'result'; call: ToolCall; ok: boolean }
  | { type: 'usage'; step: Usage; total: Usage };

export interface AgentOptions {
  gateway: Gateway;
  model: string;
  actions: Action[];
  /** The grants in force, read before every call, so a change or a revoke takes effect at once. */
  grants: () => Grants;
  /** Asks the user. Resolves `true` to run the action. */
  approve: (request: ApprovalRequest) => Promise<boolean>;
  log: Log;
  /** The app's own instructions, before the data rule. */
  system?: string;
  /** Model turns before the agent stops; 20 by default. */
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  /** The conversation, including what this run added. */
  messages: Message[];
  usage: Usage;
  /** `done`: the model finished. `stopped`: the kill switch. `limit`: `maxSteps` reached. */
  outcome: 'done' | 'stopped' | 'limit';
}

/** Runs the agent on a conversation until the model answers without asking for actions, is stopped, or hits the limit. */
export async function runAgent(options: AgentOptions, history: Message[], signal?: AbortSignal): Promise<AgentResult> {
  const { gateway, model, log } = options;
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted === true) controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const byName = new Map(options.actions.map((action) => [action.name, action]));
  const tools: ToolSpec[] = options.actions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const system = [options.system, DATA_RULE].filter((part) => part !== undefined && part !== '').join('\n\n');
  const messages: Message[] = history[0]?.role === 'system' ? [...history] : [{ role: 'system', content: system }, ...history];
  const total: Usage = { inputTokens: 0, outputTokens: 0 };
  const emit = (event: AgentEvent) => options.onEvent?.(event);
  const stopped = (): AgentResult => {
    log.append('stop', { reason: 'stopped by the user' });
    return { messages, usage: total, outcome: 'stopped' };
  };

  try {
    for (let step = 0; step < (options.maxSteps ?? 20); step++) {
      if (controller.signal.aborted) return stopped();
      const request = { model, messages, tools, signal: controller.signal };
      // Exactly what leaves the browser, where the gateway can say (ADR 0043, section 5).
      log.append('request', gateway.describe?.(request) ?? { model, messages, tools });

      let text = '';
      const calls: ToolCall[] = [];
      let usage: Usage | undefined;
      let reason = '';
      try {
        for await (const event of gateway.chat(request)) {
          if (event.type === 'text') {
            text += event.text;
            emit({ type: 'text', text: event.text });
          } else if (event.type === 'tool_call') calls.push(event.call);
          else if (event.type === 'usage') usage = event.usage;
          else reason = event.reason;
        }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof SmaltaiError && error.code === 'ABORTED')) {
          log.append('response', { text, toolCalls: calls, partial: true });
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
      if (calls.length === 0) return { messages, usage: total, outcome: 'done' };

      for (const call of calls) {
        if (controller.signal.aborted) {
          // Cancelled: the model still gets an answer for each call it made, so the conversation stays valid.
          messages.push({ role: 'tool', toolCallId: call.id, content: 'Cancelled: the user stopped the agent.' });
          log.append('result', { call, cancelled: true });
          continue;
        }
        messages.push({ role: 'tool', toolCallId: call.id, content: await runCall(call) });
      }
      if (controller.signal.aborted) return stopped();
    }
    log.append('stop', { reason: 'step limit', maxSteps: options.maxSteps ?? 20 });
    return { messages, usage: total, outcome: 'limit' };
  } finally {
    signal?.removeEventListener('abort', stop);
  }

  async function runCall(call: ToolCall): Promise<string> {
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
    let verdict: 'allow' | 'approved' | 'declined' = 'allow';
    if (decision.verdict === 'ask') {
      const approved = await options.approve({ action: action.name, input, reason: decision.reason });
      verdict = approved ? 'approved' : 'declined';
      log.append('approval', { call, reason: decision.reason, approved });
    }
    emit({ type: 'action', call, verdict });
    if (verdict === 'declined') return 'The user declined this action.';
    if (controller.signal.aborted) {
      log.append('result', { call, cancelled: true });
      return 'Cancelled: the user stopped the agent.';
    }
    log.append('action', { call, verdict });
    try {
      const result = await action.run(input, { signal: controller.signal });
      log.append('result', { call, ok: true, result });
      emit({ type: 'result', call, ok: true });
      return asData(action.name, result);
    } catch (error) {
      log.append('result', { call, ok: false, error });
      emit({ type: 'result', call, ok: false });
      return asData(action.name, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
