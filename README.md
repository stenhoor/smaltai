# smaltai

AI for the smalt apps, with a model you bring.

- **A router** in the browser to your own gateways: local models (Ollama, llama-server, LM Studio), or cloud models
  through a gateway you run that holds your key. smalt never sees or holds a key.
- **An agent in each app**, starting with smaltbi, that builds queries and reports through the app's own actions,
  within what you grant: schema only, statistics, sample rows or full data, per table and column. Everything it does is
  logged in your browser.
- **Later:** a model that runs in the browser on WebGPU.

**Status:** in development. The core package (router, grants, log, defences, agent loop) is in `src/`, tested against
recorded streams, not yet against a running gateway; no app uses it yet. The decisions are in smaltworks:
[ADR 0043](https://github.com/stenhoor/smaltworks/blob/main/adr/0043-smaltai-router-grants-and-phases.md),
[ADR 0025](https://github.com/stenhoor/smaltworks/blob/main/adr/imported/smalt-brand/0025-smaltai-agent-gateways-and-actions.md),
[ADR 0026](https://github.com/stenhoor/smaltworks/blob/main/adr/imported/smalt-brand/0026-smaltai-in-browser-llm.md).

## License

[MIT](LICENSE).
