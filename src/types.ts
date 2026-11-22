/**
 * The shapes every part of smaltai shares: messages, tools, a chat request and what a gateway streams back.
 *
 * A gateway is anything that answers a chat request: an endpoint the user registered (reached through the router), or
 * later the in-browser engine (ADR 0026), which offers the same interface without the router (ADR 0043, section 3).
 */

/** Who wrote a message. */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** A call the model asked for: the tool's name and its arguments as parsed JSON. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/** One message in a conversation. */
export interface Message {
  role: Role;
  content: string;
  /** On an assistant message: the tools it asked to call. */
  toolCalls?: ToolCall[];
  /** On a tool message: the call it answers. */
  toolCallId?: string;
}

/** A tool offered to the model. `inputSchema` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Tokens used by one request, as the gateway reports them. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** A chat request. `signal` stops it: the kill switch. */
export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

/** What a gateway streams back, in order: text and tool calls, usage when known, then `done`. */
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; reason: string };

/** A model a gateway offers. */
export interface ModelInfo {
  id: string;
}

/** Anything that answers chat requests. */
export interface Gateway {
  chat(request: ChatRequest): AsyncIterable<StreamEvent>;
  models(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** What a chat request sends, exactly: the address and the body. The log records it. */
  describe?(request: ChatRequest): { url: string; body: unknown };
}

/** The `fetch` smaltai calls. Passed in, so tests and hosts can supply their own. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;
