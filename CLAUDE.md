# CLAUDE.md

smaltai lets the smalt apps use an AI model the user brings: a router in the browser to the user's own local gateways
(local models, or cloud models through a gateway that holds the user's key), and an agent in each app that works
through the app's own actions. A model running in the browser on WebGPU follows later. Several Claude Code sessions
work on the smalt repos in parallel and cannot see each other: this file is the shared starting point.

## Direction: read smaltworks first

Read [smaltworks CONTEXT.md](https://github.com/stenhoor/smaltworks/blob/main/CONTEXT.md) before starting work. Its
standards, decisions and ADRs win over any copy here, unless smaltworks' EXCEPTIONS.md lists this repository.

smaltai's decisions are tier 1 ADRs in smaltworks:

- [ADR 0043](https://github.com/stenhoor/smaltworks/blob/main/adr/0043-smaltai-router-grants-and-phases.md) (2026-11-22,
  accepted): the router, grants, logging, defences and the phases. It wins where it differs from the two below.
- [ADR 0025](https://github.com/stenhoor/smaltworks/blob/main/adr/imported/smalt-brand/0025-smaltai-agent-gateways-and-actions.md):
  gateways, actions, permissions and context documents.
- [ADR 0026](https://github.com/stenhoor/smaltworks/blob/main/adr/imported/smalt-brand/0026-smaltai-in-browser-llm.md)
  (proposed): the in-browser engine, phase 2.

## Status

Phase 1 is designed, not built: the router and the agent in smaltbi. There is no code here yet.

1. **Phase 1:** the router (several endpoints the user registers), grants, the log, the defences, smaltbi's actions and
   the chat panel (in smaltkit), with documented existing gateways.
2. **Phase 2:** the in-browser engine (ADR 0026), its own package.
3. **Phase 3:** a gateway of our own, last, if still wanted.

## Rules that come first

- **smalt never sees or holds a key.** No API key, token or password in any code, setting, storage or memory of
  smaltai. Requests carry no credentials (no `Authorization` or key header, `credentials: 'omit'`); a test fails if
  smaltai's code sets one. A gateway that needs a credential from the app is not supported.
- **We ship no gateway in phases 1 and 2.** We document how to use existing ones (Ollama, llama-server, LM Studio, and a
  key-holding proxy such as LiteLLM). Keys, access and spending are the user's, in their tool. The aim is to keep the
  project out of security concerns.
- **Grants decide what the agent sees and does** (ADR 0043, section 4): four data levels, narrowed per table and column;
  writes granted per action; configuration tables always need explicit approval.
- **Everything is logged, locally** (section 5), complete and exportable; nothing is sent anywhere.
- **Defences are on by default** (section 6): no remote content in the chat, data marked as data, tokens shown, a kill
  switch.
- **Browser-first, TypeScript, no runtime dependencies.** Output is plain ES2022 modules that load in a page without a
  bundler.

## Working rules for sessions

- One task per branch and PR. Do not add unrelated work to an open PR: it holds up everything else in it.
- Mark unfinished work clearly, and open a PR only when CI passes.
- Read review comments on your PR and answer them with commits that say what they address.
- When a PR depends on another repo's PR, add a line such as `Depends on: stenhoor/smaltkit#12`.
- **Ask before adding outside code.** Ask the owner, and wait for a yes, before adding a package (a dependency of any
  kind, or a pin in `packed.json`), copying or bundling in someone else's code, or loading code from another site at run
  time (a CDN such as jsDelivr). Say what it is, its licence and size, what it's for, and why our own code can't do it.
  Outside code that a feature needs goes in a plugin, so it is named and optional, never in core.
- **Facts only.** Don't tell the owner something you haven't confirmed. A fact comes from the code, a command's
  output, a document you read in this session, or GitHub itself; say which when it isn't obvious. Label everything
  else as an assumption, in those words, with what would confirm it, and check before asserting when checking is
  cheap. Correct a wrong fact where you wrote it, and say so.
- **Watch your PRs to the merge.** A PR you open is yours until it is merged or closed: subscribe to its activity, fix
  CI failures and answer reviews as they arrive, then do what the merge unblocks and stop watching. Watching is
  event-driven: never poll, sleep or schedule checks for it. Merging stays with the owner.
  (Both rules: smaltworks' [session rules](https://github.com/stenhoor/smaltworks/blob/main/context/session-rules.md).)

## Brand

smaltai runs alongside the languages, kits and user tools, in the blue-leaning violet `layer-ai`. Its marks and words
are open: don't invent them; they come from [smalt-brand](https://github.com/stenhoor/smalt-brand).
