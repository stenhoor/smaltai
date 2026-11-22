/**
 * Server-sent events, as the chat completions API streams them: `data:` lines, events separated by a blank line.
 */

/** Reads a byte stream and yields each event's data (its `data:` lines joined by newlines). */
export async function* sseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.search(/\r\n|\r|\n/)) !== -1) {
        // A lone \r at the end may be the first half of \r\n: wait for the next chunk.
        if (!done && newline === buffer.length - 1 && buffer[newline] === '\r') break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith('\r\n', newline) ? 2 : 1));
        if (line === '') {
          if (data.length > 0) yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:')) {
          data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
        }
        // Other fields (event:, id:, retry:) and comments (:) aren't used by the chat API.
      }
      if (done) break;
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(buffer.startsWith('data: ') ? 6 : 5));
    if (data.length > 0) yield data.join('\n');
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
