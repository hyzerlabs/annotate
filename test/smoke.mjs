// Smoke test for the HTTP contract the extension depends on.
// Fails if discovery, claiming, screenshot decoding, or queueing breaks.
import { spawn } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Isolated runtime dir: settings.json and the saved queue are shared by every
// server for this user, so without this the tests rewrite real state.
const RUNTIME_DIR = mkdtempSync(join(tmpdir(), "hyzer-annotate-test-"))
const ENV = { ...process.env, HYZER_ANNOTATE_DIR: RUNTIME_DIR }

const PORT_START = 39280
const PORT_END = 39300
const APP_ID = "hyzer-annotate"

// 1x1 transparent png
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const child = spawn(process.execPath, ["dist/server.js"], { stdio: ["pipe", "pipe", "pipe"], env: ENV })
let stderr = ""
child.stderr.on("data", (b) => (stderr += b))

async function findServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    for (let port = PORT_START; port <= PORT_END; port++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(200) })
        const body = await res.json()
        if (body?.app === APP_ID && body?.instanceId === `${APP_ID}:${child.pid}`) return { port, body }
      } catch {
        // not us
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`server never came up. stderr:\n${stderr}`)
}

// Minimal MCP stdio client — enough to call one tool. The formatting path only
// runs here, so HTTP-only assertions would miss it entirely.
let rpcId = 0
let stdoutBuffer = ""
const pendingRpc = new Map()
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk
  let newline
  while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.slice(0, newline).trim()
    stdoutBuffer = stdoutBuffer.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line)
    const resolve = pendingRpc.get(message.id)
    if (resolve) {
      pendingRpc.delete(message.id)
      resolve(message)
    }
  }
})

function rpc(method, params) {
  const id = ++rpcId
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  return new Promise((resolve, reject) => {
    pendingRpc.set(id, resolve)
    setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 5000).unref()
  })
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
}

async function post(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return res.json()
}

try {
  const { port, body: status } = await findServer()
  assert.equal(status.server.status, "listening")
  assert.equal(status.queued, 0)

  const sessions = await (await fetch(`http://127.0.0.1:${port}/sessions`)).json()
  assert.equal(sessions.sessions.length, 1, "one server process = one session")
  const sessionId = sessions.sessions[0].id
  assert.equal(sessions.sessions[0].directory, process.cwd())

  const claimed = await post(port, "/claim", { tabId: 7, sessionId, extensionVersion: "0.1.0" })
  assert.equal(claimed.ok, true)

  const sent = await post(port, "/annotation", {
    tabId: 7,
    sessionId,
    annotation: {
      comment: "this button is misaligned",
      mode: "element",
      page: { url: "http://localhost:5173/docs", title: "Docs" },
      element: { selector: "button.hz-button", tag: "button", role: "button", text: "Save", rect: { x: 1, y: 2, width: 3, height: 4 } },
      viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
      screenshot: { mime: "image/png", dataUrl: PNG, mode: "element", cropped: true },
    },
  })
  assert.equal(sent.ok, true)
  assert.equal(sent.queued, 1)

  // page mode: no element at all, must still queue rather than blow up formatting
  const captured = await post(port, "/annotation", {
    tabId: 7,
    sessionId,
    annotation: {
      comment: "the whole layout breaks under 900px",
      mode: "page",
      page: { url: "http://localhost:5173/docs", title: "Docs" },
      element: null,
      viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
      screenshot: { mime: "image/png", dataUrl: PNG, mode: "page", truncated: true },
    },
  })
  assert.equal(captured.ok, true)
  assert.equal(captured.queued, 2)

  // screenshot toggle off: no image at all, must queue and format cleanly
  const noShot = await post(port, "/annotation", {
    tabId: 7,
    sessionId,
    annotation: {
      comment: "rename this variable",
      mode: "element",
      page: { url: "http://localhost:5173/docs", title: "Docs" },
      element: { selector: "code.token", tag: "code", role: "", text: "foo", rect: { x: 0, y: 0, width: 10, height: 10 } },
      viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
      screenshot: null,
    },
  })
  assert.equal(noShot.ok, true)
  assert.equal(noShot.queued, 3)

  const after = await (await fetch(`http://127.0.0.1:${port}/status`)).json()
  assert.equal(after.queued, 3)
  assert.equal(after.claims.length, 1)
  assert.equal(after.claims[0].tabId, 7)

  // screenshot decoded and written to disk
  const shots = after.annotationDir
  assert.ok(existsSync(shots), "annotation dir exists")
  const { readdirSync } = await import("node:fs")
  const written = readdirSync(shots).filter((f) => f.endsWith(".png"))
  assert.ok(written.length > 0, "screenshot written")
  assert.ok(statSync(`${shots}/${written[written.length - 1]}`).size > 0, "screenshot non-empty")

  // drain over MCP — exercises formatAnnotation for both modes
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  })
  notify("notifications/initialized")
  const drained = await rpc("tools/call", { name: "get_annotations", arguments: {} })
  const text = drained.result.content[0].text
  assert.match(text, /3 annotation\(s\)/)
  assert.match(text, /Selector: button\.hz-button/, "element mode keeps selector")
  assert.match(text, /cropped to the element/)
  assert.match(text, /Scope: whole page/, "page mode says so instead of printing empty element fields")
  assert.match(text, /whole page, truncated/)
  assert.match(text, /Screenshot: none/, "an omitted screenshot is stated, not silently absent")
  assert.doesNotMatch(text, /<\?>/, "no placeholder element rendered for page-mode annotations")

  const emptied = await (await fetch(`http://127.0.0.1:${port}/status`)).json()
  assert.equal(emptied.queued, 0, "get_annotations drains the queue")

  const unclaimed = await post(port, "/unclaim", { tabId: 7 })
  assert.equal(unclaimed.ok, true)

  // bad input is rejected, not queued
  const bad = await post(port, "/annotation", { tabId: 7, sessionId })
  assert.equal(bad.ok, false)

  console.log("smoke: ok")
} finally {
  child.kill("SIGTERM")
}
