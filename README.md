# hyzer-annotate

Click an element in your browser, type what's wrong with it, and your coding agent gets the comment, the element metadata, and a screenshot — anchored to the thing you actually pointed at.

Works with any agent that speaks MCP. Nothing leaves your machine.

## How it works

The MCP server binds a port on `127.0.0.1` (39280-39300) when your agent starts it. The extension scans that range to find running sessions, you connect a tab to one, and each annotation you submit is POSTed to that session's server. The agent drains the queue when you ask it to.

One server process per agent session, so the extension's session picker lists one entry per running agent.

## Setup

```sh
npm install
npm run build:all
```

**Load the extension:** open `brave://extensions` (or `chrome://extensions`), enable Developer mode, click "Load unpacked", and select the `extension/` directory.

**Register the MCP server** with your agent, pointing at the absolute path of `dist/server.js`.

For Claude Code, in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "hyzer-annotate": {
      "command": "node",
      "args": ["/absolute/path/to/hyzer-annotate/dist/server.js"]
    }
  }
}
```

Restart the agent after adding it.

## Use

1. Click the extension icon and connect the tab to your agent session.
2. Click **Annotate** in the in-page pill, then click the element you want to talk about.
3. Type your comment and submit. Repeat as many times as you like.
4. Tell your agent to check the annotations. It calls `get_annotations`, which drains everything you've queued.

Batching is on the receiving end: every annotation POSTs immediately, and the agent picks up the whole queue in one call. There's no "send" step to remember.

Screenshots are written to a temp directory and passed to the agent as file paths, so it can read the image only when it needs to.

## Development

```sh
npm run check   # typecheck + smoke test + extension build
```

`npm test` builds the server and exercises the HTTP contract the extension depends on — discovery, claiming, screenshot decoding, queueing, and input rejection.

## License

GPL-3.0-only. This is a modified derivative of [opencode-chrome-annotation](https://github.com/JodusNodus/opencode-chrome-annotation) by Benjamin Shafii. See [NOTICE](./NOTICE) for what changed.
