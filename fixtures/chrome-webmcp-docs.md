# WebMCP

Chrome for Developers WebMCP documentation. Prose is licensed under CC BY 4.0. Code samples are licensed under Apache 2.0. Source: https://developer.chrome.com/docs/ai/webmcp

## WebMCP and agents

WebMCP is a proposed web standard to help you build and expose structured tools for AI agents. WebMCP provides JavaScript and annotates HTML form elements so that agents know exactly how to interact with page features, to support a user's experience. This can significantly improve the performance and reliability of agent actuation.

AI agents are a newer technology. They can help human users better complete tasks which are highly complex and technical. WebMCP offers higher accuracy for agentic task completion, and it can be added as a progressive enhancement.

## Why WebMCP?

WebMCP can help you bridge the gap between web applications and agents, improving efficiency, reliability, and task completion, by providing rules for interaction. Instead of an agent reviewing the element, such as a button or a field, to understand its purpose, the website declares the element's purpose, so it's used correctly.

This is more reliable than actuation, which may have numerous steps and leaves each step open to interpretation by the agent. Websites can share explicit purpose, such as search or purchasing, by defining a tool. Tools execute on your webpage visibly, so users gain trust that tasks are completed as expected.

## Shared page state

WebMCP supports discovery: a standard way for pages to register tools with agents. JSON Schemas provide explicit definitions of inputs and expected outputs, to reduce hallucination or misunderstanding. State provides a shared understanding of the current page context, so the agent knows what resources are available to act on in real time.

## Imperative API

You can use the WebMCP Imperative API to define many types of tools with standard JavaScript. Your tools can execute different functions, such as form input, site navigation, and state management. Use the `modelContext` interface to register tools. Tool registration requires a name, description, and input schema with relevant properties.

```js
await document.modelContext.registerTool({
  name: 'toggle_layer',
  description: 'Control pizza layers (sauce, cheese). Use "add", "remove", or "toggle".',
  inputSchema: {
    type: 'object',
    properties: {
      layer: { type: 'string', enum: ['sauce-layer', 'cheese-layer'] },
      action: { type: 'string', enum: ['add', 'remove', 'toggle'] },
    },
    required: ['layer'],
  },
  execute: async ({ layer, action }) => {
    await toggleLayer(layer, action);
    return `Performed ${action || 'toggle'} on layer: ${layer}`;
  },
});
```

## Local testing and security

Join the WebMCP origin trial from Chrome 149. WebMCP is available as a Chrome flag for local development: open `chrome://flags/#enable-webmcp-testing`, set the flag to Enabled, and relaunch Chrome to apply the changes.

WebMCP APIs are gated by both origin isolation requirements and permissions policy. WebMCP is only available in origin-isolated documents. If a document has `document.domain` enabled, for example by using the `Origin-Agent-Cluster: ?0` HTTP header, WebMCP APIs are disabled.
