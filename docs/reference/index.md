# Reference

The core package, `@smaltworks/smaltai`, is in development and not published. Its pieces, each a module of `src/`:

| Module | What it does |
| --- | --- |
| `credentials` | `guardedFetch`: every request goes through it, refuses credential headers and credentials in an address, and sends `credentials: 'omit'` |
| `endpoint` | `endpoint()`: an endpoint is an id, a name, an address and a format, never a key |
| `router` | `createRouter()`: the endpoints the user registered (in the order of their ids), and the endpoint and model chosen for each chat; asynchronous, over a `RouterStore` (`memoryRouterStore()`, or the store entry point) |
| `openai` | `openaiGateway()`: the chat completions API, streamed (Ollama, llama-server, LM Studio, LiteLLM) |
| `grants` | Data levels, exclusions per table and column, an action's policy (its kind, what it touches, whether it can be undone, whether it runs code the model wrote), `decide()` (allow, or ask and whether it may be granted), `ROWS_WARNING`, `shapeRows()`, `createGrantStore()` (asynchronous, over `GrantRecords`: `memoryGrantRecords()`, or the store entry point) |
| `log` | `memoryLog()` and `logToJsonl()`: every request, response, action, approval and grant change. Asynchronous: each request is recorded before it is sent |
| `defences` | `asData()` (data marked as data) and `withoutRemoteContent()` (no images or links loaded) |
| `agent` | `runAgent()`: the loop over an app's actions, each started as soon as the model calls it, with grants, approvals (once or grant), the token count, smaltai's own timings, a step limit the user sets (20 to start) and the kill switch; `checkActions()`. A call whose input doesn't match its action's schema goes back to the model as an error, before the grants and before the user is asked |
| `schema` | `inputProblem()`: why a call's input doesn't match an action's input schema (`input.name: expected a string, got a number`). `schemaProblem()`: why a schema uses something smaltai doesn't check. The subset checked: `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum` and `anyOf`, with the notes `title`, `description`, `default`, `examples` and `$comment` |
| `errors` | `SmaltaiError`, with codes prefixed `SMALTAI_` |
| `store` (`@smaltworks/smaltai/store`) | `attachStore(database)`: the log, grants, endpoints and chosen models in smaltai's own database, through smaltts, in four tables (`smaltai_log`, `smaltai_endpoints`, `smaltai_grants`, `smaltai_choices`). The app opens the database and passes it in |

*Planned:* a page per function in the family's shape, and the chat panel (in smaltkit).
