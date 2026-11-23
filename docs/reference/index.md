# Reference

The core package, `@smaltworks/smaltai`, is in development and not published. Its pieces, each a module of `src/`:

| Module | What it does |
| --- | --- |
| `credentials` | `guardedFetch`: every request goes through it, refuses credential headers and credentials in an address, and sends `credentials: 'omit'` |
| `endpoint` | `endpoint()`: an endpoint is an id, a name, an address and a format, never a key |
| `router` | `createRouter()`: the endpoints the user registered, and the endpoint and model chosen for each chat |
| `openai` | `openaiGateway()`: the chat completions API, streamed (Ollama, llama-server, LM Studio, LiteLLM) |
| `grants` | Data levels, exclusions per table and column, an action's policy (its kind, what it touches, whether it can be undone, whether it runs code the model wrote), `decide()` (allow, or ask and whether it may be granted), `ROWS_WARNING`, `shapeRows()`, `createGrantStore()` |
| `log` | `memoryLog()` and `logToJsonl()`: every request, response, action, approval and grant change |
| `defences` | `asData()` (data marked as data) and `withoutRemoteContent()` (no images or links loaded) |
| `agent` | `runAgent()`: the loop over an app's actions, each started as soon as the model calls it, with grants, approvals (once or grant), the token count, smaltai's own timings, a step limit the user sets (20 to start) and the kill switch; `checkActions()` |
| `errors` | `SmaltaiError`, with codes prefixed `SMALTAI_` |

*Planned:* a page per function in the family's shape, the log, grants and endpoints kept in smaltdb (`@smaltworks/smaltai/smaltdb`), and the chat panel (in smaltkit).
