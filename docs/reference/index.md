# Reference

The core package, `@smaltworks/smaltai`, is in development and not published. Its pieces, each a module of `src/`:

| Module | What it does |
| --- | --- |
| `credentials` | `guardedFetch`: every request goes through it, refuses credential headers and credentials in an address, and sends `credentials: 'omit'` |
| `endpoint` | `endpoint()`: an endpoint is an id, a name, an address and a format, never a key |
| `router` | `createRouter()`: the endpoints the user registered, and the endpoint and model chosen for each chat |
| `openai` | `openaiGateway()`: the chat completions API, streamed (Ollama, llama-server, LM Studio, LiteLLM) |
| `grants` | Data levels, exclusions per table and column, `decide()` (allow or ask), `shapeRows()`, `createGrantStore()` |
| `log` | `memoryLog()` and `logToJsonl()`: every request, response, action, approval and grant change |
| `defences` | `asData()` (data marked as data) and `withoutRemoteContent()` (no images or links loaded) |
| `agent` | `runAgent()`: the loop over an app's actions, with grants, approvals, the token count and the kill switch |

*Planned:* a page per function in the family's shape, the log kept in IndexedDB, and the chat panel (in smaltkit).
