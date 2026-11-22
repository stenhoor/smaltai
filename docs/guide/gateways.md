# Gateways

A gateway is where your model is reached. smaltai calls it from the browser; there is no smaltworks server in between.
**smaltai ships no gateway of its own:** you run an existing one, and keys, access and spending stay with you and your
tool.

You can register several gateways, each with its address and format (the OpenAI-compatible chat API first), and pick
one, and a model, for each chat. A gateway's settings have no field for a key.

## Letting the apps reach your gateway

The smalt apps are served from `https://stenhoor.github.io`. Your gateway must allow that origin (CORS):

| Gateway | For | Setting |
| --- | --- | --- |
| [Ollama](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) | Local models | Ollama allows only `127.0.0.1` and `0.0.0.0` by default. Set `OLLAMA_ORIGINS=https://stenhoor.github.io` |
| [llama.cpp's llama-server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) | Local models | `--cors-origins` defaults to `*`; set it to `https://stenhoor.github.io` to allow only the apps |
| [LM Studio](https://lmstudio.ai/docs/developer/openai-api) | Local models | CORS is a setting of its local server (`lms server start --cors`, or the app's server settings) |
| [LiteLLM proxy](https://github.com/BerriAI/litellm) | Cloud models with your key | `LITELLM_CORS_ORIGINS=https://stenhoor.github.io` |

Chrome may ask you once to allow the page to reach your local network.

*Planned:* a step-by-step recipe for each, checked against the tool's current version.

::: warning Your gateway, your keys
A gateway that holds a cloud key can spend money on your behalf. Allow only the apps' origin, keep the gateway on your
own machine or network, and set spending limits in the gateway where it offers them.
:::
