# hyzer-annotate

Click an element in your browser, type what's wrong with it, and your coding agent gets the comment, the element metadata, and a screenshot — anchored to the thing you actually pointed at.

Works with any agent that speaks MCP. Nothing leaves your machine.

## How it works

The MCP server binds a port on `127.0.0.1` (39280-39300) when your agent starts it. The extension scans that range to find running sessions, you connect a tab to one, and each annotation you submit is POSTed to that session's server. The agent drains the queue when you ask it to.

There's one server process per agent session, so the session picker lists one entry per running agent.

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

User scope is usually the better choice. Each agent process binds its own port and the extension discovers whichever ones are running, so registering it globally costs nothing and saves you repeating this per repo.

Restart the agent after adding it.

### Optional: a `/fb` shortcut

Asking your agent to "check annotations" works fine. A slash command is shorter. Save this as `~/.claude/commands/fb.md`:

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
2. In the in-page pill, choose either:
   - **Annotate** — click the element you want to talk about, then comment on it.
   - **Capture** — comment on the page as a whole, no element picking.
3. Submit. Repeat as many times as you like.
4. Tell your agent to check the annotations, or run `/fb` if you added the command above. Either way it calls `get_annotations`, which drains everything you've queued.

There's no "send" step to remember. Every annotation POSTs the moment you submit it, and the agent collects the whole queue in one call.

Use the **×** in the pill to disconnect the tab. It also disconnects on its own when you close the tab, navigate to a different origin, or stop the agent.

## Screenshots

Every annotation carries one unless you clear **Include screenshot** in the composer. **Annotate** crops to the element you picked, with a little padding for context. **Capture** stitches the whole scrollable page together from viewport captures. Either way the image is written to a temp directory and handed to the agent as a file path, so it only loads the image when it needs to.

The pill hides itself during capture so it stays out of the shot.

Two things worth knowing about full-page capture:

- `captureVisibleTab` is rate-limited to 2 calls/sec, so a tall page takes a beat, and stitching stops at 12 viewport-heights. The agent is told when a shot was truncated.
- Fixed and sticky elements are hidden after the first band. Otherwise a sticky header gets stamped into every strip. A sticky sidebar will leave a gap where it was.

Images are swept once they're more than six hours old, rather than when the queue drains. The agent reads those paths *after* `get_annotations` returns, so deleting on drain would hand it dead paths. Anything still queued is never swept, however old it gets.

## Keeping the queue across restarts

The queue lives in memory, so restarting your agent discards anything you haven't asked it to read yet. Tick **Keep queue across restarts** in the pill to write it to the runtime directory instead. The setting is stored there too, since a toggle that reset on restart would forget at exactly the wrong moment.

It's off by default. It applies to every project rather than per-repo, being a preference about your machine rather than about any one codebase, and the saved copy is discarded as soon as the agent drains the queue.

Set `HYZER_ANNOTATE_DIR` to move the runtime directory somewhere else.

## Development

```sh
npm run check   # typecheck, tests, extension build
```

`npm test` runs four suites:

- `geometry.mjs` — capture and placement arithmetic: crop clamping, zoom scaling, band planning, stitch height, and the composer's flip-above-when-there's-no-room-below.
- `token-scope.mjs` — runs the `:root` to `:host` rewrite over the real installed `@hyzer-labs/ui` stylesheet, so an upgrade that adds a `:root` selector fails here instead of silently shipping unstyled overlays.
- `smoke.mjs` — boots the server and exercises the HTTP contract the extension depends on: discovery, claiming, screenshot decoding, queueing, input rejection. Then drains over MCP to check every annotation shape formats correctly.
- `persistence.mjs` — restarts the server for real, which is the only way to prove the queue survives one.

The server tests run against `HYZER_ANNOTATE_DIR`. Settings and the saved queue are shared by every server for a user, so without an override the suite would rewrite your real state.

### Packaging

```sh
npm run icons              # regenerate icons/*.png from icon.svg (macOS only)
npm run package:extension  # build and zip into release/ for the Chrome Web Store
```

The extension version comes from `package.json` and is stamped into the manifest at build time. `extension-src/manifest.json` has no `version` field at all, so there's no second copy to forget on a release.

Icons are committed under `icons/` rather than generated during the build. Rasterizing needs `sips`, which is macOS-only, so generating them at build time would quietly ship an iconless extension on Linux and in CI. `npm run build:extension` fails outright if they're missing.

## License

GPL-3.0-only. This is a modified derivative of [opencode-chrome-annotation](https://github.com/JodusNodus/opencode-chrome-annotation) by Benjamin Shafii. See [NOTICE](./NOTICE) for what changed.
