// Queue persistence across a server restart, which is the whole point of the
// toggle and cannot be proven without actually restarting the process.
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
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
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const running = []

function startServer() {
  const child = spawn(process.execPath, ["dist/server.js"], { stdio: ["pipe", "pipe", "pipe"], env: ENV })
  child.stderr.resume()
  child.stdout.resume()
  running.push(child)
  return child
}

async function findServer(child) {
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
  throw new Error("server never came up")
}

async function post(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return res.json()
}

function annotation(comment) {
  return {
    comment,
    mode: "element",
    page: { url: "http://localhost:5173/", title: "App" },
    element: { selector: "main", tag: "main", role: "", text: "", rect: { x: 0, y: 0, width: 1, height: 1 } },
    viewport: { width: 800, height: 600, devicePixelRatio: 1 },
    screenshot: { mime: "image/png", dataUrl: PNG, mode: "element", cropped: true },
  }
}

async function stop(child) {
  child.kill("SIGTERM")
  await new Promise((resolve) => child.once("exit", resolve))
}

try {
  // ── persistence off (the default): a restart loses the queue ──────────
  const first = startServer()
  const { port: p1, body: status1 } = await findServer(first)
  assert.equal(status1.persistQueue, false, "off by default — feedback should not hit disk unasked")
  assert.equal(status1.queuePath, null)

  await post(p1, "/claim", { tabId: 1, sessionId: status1.sessionId })
  await post(p1, "/annotation", { tabId: 1, sessionId: status1.sessionId, annotation: annotation("ephemeral") })
  assert.equal((await (await fetch(`http://127.0.0.1:${p1}/status`)).json()).queued, 1)
  await stop(first)

  const second = startServer()
  const { port: p2, body: status2 } = await findServer(second)
  assert.equal(status2.queued, 0, "nothing persisted, so nothing comes back")

  // ── turn it on, then restart ──────────────────────────────────────────
  const enabled = await post(p2, "/settings", { persistQueue: true })
  assert.equal(enabled.ok, true)
  assert.equal(enabled.persistQueue, true)

  await post(p2, "/claim", { tabId: 1, sessionId: status2.sessionId })
  await post(p2, "/annotation", { tabId: 1, sessionId: status2.sessionId, annotation: annotation("survives") })
  await post(p2, "/annotation", { tabId: 1, sessionId: status2.sessionId, annotation: annotation("also survives") })

  const beforeRestart = await (await fetch(`http://127.0.0.1:${p2}/status`)).json()
  assert.equal(beforeRestart.queued, 2)
  assert.ok(beforeRestart.queuePath, "status reports where the queue lives once persisting")
  assert.ok(existsSync(beforeRestart.queuePath), "queue file written")
  await stop(second)

  const third = startServer()
  const { port: p3, body: status3 } = await findServer(third)
  assert.equal(status3.persistQueue, true, "the setting itself survives — otherwise the toggle is useless")
  assert.equal(status3.queued, 2, "queue restored across the restart")

  // the restored entries still format, and their screenshots are still on disk
  const drained = await drainOverMcp(third)
  assert.match(drained, /survives/)
  assert.match(drained, /also survives/)
  const shotPath = drained.match(/- Screenshot: (\S+\.png)/)?.[1]
  assert.ok(shotPath && existsSync(shotPath), "restored entry still points at a real screenshot")

  // draining clears the saved copy so a later restart does not resurrect it
  assert.equal(existsSync(beforeRestart.queuePath), false, "saved queue discarded after drain")

  // ── turning it off removes the file rather than leaving a stale one ────
  await post(p3, "/claim", { tabId: 1, sessionId: status3.sessionId })
  await post(p3, "/annotation", { tabId: 1, sessionId: status3.sessionId, annotation: annotation("temp") })
  assert.ok(existsSync(beforeRestart.queuePath), "written again while still persisting")
  const disabled = await post(p3, "/settings", { persistQueue: false })
  assert.equal(disabled.persistQueue, false)
  assert.equal(existsSync(beforeRestart.queuePath), false, "no stale queue file left behind")

  // bad input rejected
  const bad = await post(p3, "/settings", { persistQueue: "yes" })
  assert.equal(bad.ok, false)

  // screenshots are not deleted on drain — the agent reads the paths afterwards
  const shots = readdirSync(status3.annotationDir).filter((f) => f.endsWith(".png"))
  assert.ok(shots.length > 0, "recent screenshots survive a drain")

  console.log("persistence: ok")
} finally {
  for (const child of running) child.kill("SIGKILL")
}

async function drainOverMcp(child) {
  let buffer = ""
  const pending = new Map()
  child.stdout.on("data", (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
  })

  let id = 0
  const rpc = (method, params) => {
    const current = ++id
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: current, method, params })}\n`)
    return new Promise((resolve, reject) => {
      pending.set(current, resolve)
      setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 5000).unref()
    })
  }

  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } })
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
  const result = await rpc("tools/call", { name: "get_annotations", arguments: {} })
  return result.result.content[0].text
}
