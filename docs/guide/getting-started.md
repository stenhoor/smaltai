# What you need

*Planned.* What smaltai will need when it is built:

- **A gateway you run:** a local model server, or a proxy that holds your cloud provider's key
  ([Gateways](gateways)). smaltai itself holds no keys.
- **A browser that can reach it.** Chrome, Edge and Firefox. **Safari isn't supported for now**: it may block a page
  served over https from reaching a server on your own machine. Safari gets AI later, through a model that runs in the
  browser.
- **An app with the agent.** smaltbi first; smaltnb, smaltui and smaltfl after it.

smaltai is optional. Without a gateway, the apps show no AI at all and don't load smaltai's code.
