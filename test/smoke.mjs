// Smoke test for the HTTP contract the extension depends on.
// Fails if discovery, claiming, screenshot decoding, or queueing breaks.
import { spawn } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import assert from "node:assert/strict"

const PORT_START = 39280
const PORT_END = 39300
const APP_ID = "hyzer-annotate"

// 1x1 transparent png
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const child = spawn(process.execPath, ["dist/server.js"], { stdio: ["pipe", "pipe", "pipe"] })
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
      page: { url: "http://localhost:5173/docs", title: "Docs" },
      element: { selector: "button.hz-button", tag: "button", role: "button", text: "Save", rect: { x: 1, y: 2, width: 3, height: 4 } },
      viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
      screenshot: { mime: "image/png", dataUrl: PNG },
    },
  })
  assert.equal(sent.ok, true)
  assert.equal(sent.queued, 1)

  const after = await (await fetch(`http://127.0.0.1:${port}/status`)).json()
  assert.equal(after.queued, 1)
  assert.equal(after.claims.length, 1)
  assert.equal(after.claims[0].tabId, 7)

  // screenshot decoded and written to disk
  const shots = after.annotationDir
  assert.ok(existsSync(shots), "annotation dir exists")
  const { readdirSync } = await import("node:fs")
  const written = readdirSync(shots).filter((f) => f.endsWith(".png"))
  assert.ok(written.length > 0, "screenshot written")
  assert.ok(statSync(`${shots}/${written[written.length - 1]}`).size > 0, "screenshot non-empty")

  const unclaimed = await post(port, "/unclaim", { tabId: 7 })
  assert.equal(unclaimed.ok, true)

  // bad input is rejected, not queued
  const bad = await post(port, "/annotation", { tabId: 7, sessionId })
  assert.equal(bad.ok, false)

  console.log("smoke: ok")
} finally {
  child.kill("SIGTERM")
}
