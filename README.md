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

For Claude Code, register it once at user scope so it's available in every project you annotate:

```sh
claude mcp add hyzer-annotate --scope user -- node /absolute/path/to/hyzer-annotate/dist/server.js
```

Or per-project, in that project's `.mcp.json`:

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

User scope is usually what you want — the server binds a port per agent process and the extension discovers whichever ones are running, so registering it everywhere costs nothing and saves you doing this per repo.

Restart the agent after adding it.

**Optional — a shortcut to drain the queue.** Anything like "check annotations" works, but a slash command is shorter. Put this in `~/.claude/commands/fb.md` (user scope, matching the server above):

```markdown
---
description: Drain the browser annotation queue and act on the feedback
---

Call `get_annotations` to drain the browser annotation queue.

For each annotation: the comment is the ask, the selector and element metadata
say where, and the screenshot path is there when you need to see it — read it
if the comment is visual ("this looks wrong", "spacing is off"), skip it if the
comment already tells you what to change.

Then do the work. Group annotations that touch the same component into one edit
rather than fixing them one at a time.

$ARGUMENTS
```

Then `/fb` drains and acts, or `/fb just summarize, don't edit` to steer it.

## Use

1. Click the extension icon and connect the tab to your agent session.
2. In the in-page pill, either:
   - **Annotate** — click the element you want to talk about, then comment on it.
   - **Capture** — comment on the page as a whole, no element picking.
3. Submit. Repeat as many times as you like.
4. Tell your agent to check the annotations (or `/fb`, if you added the command above). It calls `get_annotations`, which drains everything you've queued.

Use the **×** in the pill to disconnect the tab. It also disconnects on its own when you close the tab, navigate to a different origin, or the agent stops.

Batching is on the receiving end: every annotation POSTs immediately, and the agent picks up the whole queue in one call. There's no "send" step to remember.

## Screenshots

Every annotation carries one. **Annotate** crops to the element you picked (plus a little padding for context); **Capture** stitches the whole scrollable page from viewport captures. Either way the image is written to a temp directory and passed to the agent as a file path, so it reads the image only when it needs to.

The pill hides itself during capture so it stays out of the shot. Two things worth knowing about full-page capture:

- `captureVisibleTab` is rate-limited to 2 calls/sec, so a tall page takes a beat — and stitching stops at 12 viewport-heights. The agent is told when a shot was truncated.
- Fixed and sticky elements are hidden after the first band, otherwise a sticky header gets stamped into every strip. A sticky sidebar will leave a gap.

## Development

```sh
npm run check   # typecheck + smoke test + extension build
```

`npm test` runs two checks. `test/geometry.mjs` covers the capture arithmetic — crop clamping, zoom scaling, band planning, stitch height. `test/smoke.mjs` boots the server and exercises the HTTP contract the extension depends on — discovery, claiming, screenshot decoding, queueing, input rejection — then drains the queue over MCP to check both annotation shapes format correctly.

## License

GPL-3.0-only. This is a modified derivative of [opencode-chrome-annotation](https://github.com/JodusNodus/opencode-chrome-annotation) by Benjamin Shafii. See [NOTICE](./NOTICE) for what changed.
