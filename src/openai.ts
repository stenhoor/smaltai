/**
 * The `openai` format: the chat completions API (`/v1/chat/completions`, `/v1/models`), streamed. Ollama, llama-server,
 * LM Studio and LiteLLM serve it. Requests go through {@link guardedFetch}, so they never carry a credential.
 */
import { guardedFetch } from './credentials.js';
import type { Endpoint } from './endpoint.js';
import { SmaltaiError } from './errors.js';
import { sseData } from './sse.js';
import type { ChatRequest, Fetch, Gateway, Message, ModelInfo, StreamEvent, ToolCall, ToolSpec } from './types.js';

/** The body of a chat completions request for a {@link ChatRequest}. Exported for the log and for tests. */
export function openaiBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(wireMessage),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (request.tools !== undefined && request.tools.length > 0) body.tools = request.tools.map(wireTool);
  return body;
}

function wireMessage(message: Message): Record<string, unknown> {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content === '' ? null : message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function wireTool(tool: ToolSpec): Record<string, unknown> {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

/** Parses a tool call's arguments. Text that isn't JSON is kept as the string, for the agent to refuse. */
function parseArguments(text: string): unknown {
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

/** Options for {@link openaiGateway}. */
export interface OpenAIGatewayOptions {
  /** The `fetch` to use; the global one by default. It is always wrapped by {@link guardedFetch}. */
  fetch?: Fetch;
}

/** A gateway that speaks the chat completions API at an endpoint. */
export function openaiGateway(endpoint: Endpoint, options: OpenAIGatewayOptions = {}): Gateway {
  const base = endpoint.url;
  const send = guardedFetch(options.fetch ?? ((input, init) => globalThis.fetch(input, init)));

  async function request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, { ...init, signal });
    } catch (error) {
      if (error instanceof SmaltaiError) throw error;
      if (isAbort(error, signal)) throw new SmaltaiError('ABORTED', 'Stopped.', { cause: error });
      throw new SmaltaiError(
        'GATEWAY_UNREACHABLE',
        `Can't reach ${endpoint.name} at ${base}. Is it running, and does it allow this page's origin?`,
        { cause: error },
      );
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 500);
      throw new SmaltaiError('GATEWAY_ERROR', `${endpoint.name} answered ${response.status}${text === '' ? '' : `: ${text}`}`, {
        status: response.status,
      });
    }
    return response;
  }

  async function* chat(chatRequest: ChatRequest): AsyncGenerator<StreamEvent> {
    const { signal } = chatRequest;
    const response = await request(
      '/v1/chat/completions',
      { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(openaiBody(chatRequest)) },
      signal,
    );
    if (response.body === null) throw new SmaltaiError('STREAM_INVALID', `${endpoint.name} sent no body.`);

    const calls = new Map<number, PendingCall>();
    let reason = 'stop';
    let flushed = false;
    const flush = function* (): Generator<StreamEvent> {
      if (flushed) return;
      flushed = true;
      for (const index of [...calls.keys()].sort((a, b) => a - b)) {
        const pending = calls.get(index)!;
        const call: ToolCall = { id: pending.id === '' ? `call_${index}` : pending.id, name: pending.name, arguments: parseArguments(pending.args) };
        yield { type: 'tool_call', call };
      }
    };

    try {
      for await (const data of sseData(response.body, signal)) {
        if (data.trim() === '[DONE]') break;
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch (error) {
          throw new SmaltaiError('STREAM_INVALID', `${endpoint.name} sent an event that isn't JSON.`, { cause: error });
        }
        if (chunk?.error !== undefined) {
          const message = typeof chunk.error?.message === 'string' ? chunk.error.message : JSON.stringify(chunk.error);
          throw new SmaltaiError('GATEWAY_ERROR', `${endpoint.name}: ${message}`);
        }
        const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
        const delta = choice?.delta;
        if (typeof delta?.content === 'string' && delta.content !== '') yield { type: 'text', text: delta.content };
        if (Array.isArray(delta?.tool_calls)) {
          for (const part of delta.tool_calls) {
            const index = typeof part?.index === 'number' ? part.index : calls.size;
            const pending = calls.get(index) ?? { id: '', name: '', args: '' };
            if (typeof part?.id === 'string') pending.id = part.id;
            if (typeof part?.function?.name === 'string') pending.name += part.function.name;
            if (typeof part?.function?.arguments === 'string') pending.args += part.function.arguments;
            calls.set(index, pending);
          }
        }
        if (typeof choice?.finish_reason === 'string') {
          reason = choice.finish_reason;
          yield* flush();
        }
        const usage = chunk?.usage;
        if (usage !== undefined && usage !== null && typeof usage.prompt_tokens === 'number') {
          yield { type: 'usage', usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens ?? 0 } };
        }
      }
    } catch (error) {
      if (error instanceof SmaltaiError) throw error;
      if (isAbort(error, signal)) throw new SmaltaiError('ABORTED', 'Stopped.', { cause: error });
      throw new SmaltaiError('STREAM_INVALID', `The stream from ${endpoint.name} broke off.`, { cause: error });
    }
    if (signal?.aborted === true) throw new SmaltaiError('ABORTED', 'Stopped.');
    yield* flush();
    yield { type: 'done', reason };
  }

  async function models(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await request('/v1/models', { method: 'GET', headers: { accept: 'application/json' } }, signal);
    const json: any = await response.json().catch((error: unknown) => {
      throw new SmaltaiError('STREAM_INVALID', `${endpoint.name} sent a model list that isn't JSON.`, { cause: error });
    });
    const list = Array.isArray(json?.data) ? json.data : [];
    return list.filter((m: any) => typeof m?.id === 'string').map((m: any) => ({ id: m.id }));
  }

  const describe = (chatRequest: ChatRequest) => ({ url: `${base}/v1/chat/completions`, body: openaiBody(chatRequest) });

  return { chat, models, describe };
}
