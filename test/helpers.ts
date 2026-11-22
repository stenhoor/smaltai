// Test helpers: a recording fetch that answers with server-sent events, and a scripted gateway.
import type { ChatRequest, Fetch, Gateway, StreamEvent } from '@smaltworks/smaltai';

export interface Sent {
  url: string;
  init: RequestInit;
}

/** A body that streams `chunks` (strings) one by one. */
export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]!));
      else controller.close();
    },
  });
}

/** Server-sent events for chat completion chunks, then `[DONE]`. */
export function sse(chunks: unknown[]): string[] {
  return [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), 'data: [DONE]\n\n'];
}

/** A fetch that records what it was sent and answers with `respond`. */
export function recordingFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>): { fetch: Fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, init });
      return respond(url, init);
    },
  };
}

export function sseResponse(chunks: string[]): Response {
  return new Response(streamOf(chunks), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A gateway that plays one list of events per request, and records the requests. */
export function scriptedGateway(turns: StreamEvent[][]): Gateway & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    async *chat(request) {
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const turn = turns.shift();
      if (turn === undefined) throw new Error('No more scripted turns.');
      for (const event of turn) {
        if (request.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        yield event;
      }
    },
    async models() {
      return [{ id: 'test-model' }];
    },
  };
}
