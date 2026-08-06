// hyzer-annotate — local annotation server + MCP bridge.
//
// Derived from opencode-chrome-annotation (GPL-3.0-only) by Benjamin Shafii.
// The HTTP contract and claim handling follow the original; the OpenCode
// plugin push path is replaced by an MCP tool the agent pulls from.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { createServer, type Server } from "node:http"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_JSON_PATH = join(__dirname, "..", "package.json")

const APP_ID = "hyzer-annotate"
const PORT_START = 39280
const PORT_END = 39300
const LISTEN_HOST = "127.0.0.1"
const CLAIM_TTL_MS = 5 * 60 * 1000
// ponytail: annotations live in memory only — a queue drained by the agent.
// If you ever want them to survive an agent restart, persist to ANNOTATION_DIR.
const QUEUE_LIMIT = 200

const BASE_DIR = getRuntimeBaseDir()
const LOG_PATH = join(BASE_DIR, "server.log")
const ANNOTATION_DIR = join(BASE_DIR, "annotations")

const sessionId = `${APP_ID}:${process.pid}`
const directory = process.cwd()
const sessionLabel = `${basename(directory) || "project"}`

let listeningPort: number | null = null
let httpServer: Server | null = null
let serverStatus: "starting" | "listening" | "failed" = "starting"
let serverError: string | null = null
let lastExtensionVersion: string | null = null

type QueuedAnnotation = {
  receivedAt: string
  tabId: number
  annotation: any
  screenshotPath: string | null
}

const queue: QueuedAnnotation[] = []
const claims = new Map<number, { sessionId: string; claimedAt: string; lastSeenAt: string; extensionVersion?: string }>()

function getRuntimeBaseDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : null
  const candidates = [
    process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, APP_ID) : null,
    join(tmpdir(), `${APP_ID}-${uid ?? "user"}`),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      mkdirSync(candidate, { recursive: true, mode: 0o700 })
      return candidate
    } catch {
      // try the next location
    }
  }
  return join(tmpdir(), `${APP_ID}-${uid ?? "user"}`)
}

// stdout is the MCP transport — never log there.
function logDebug(message: string): void {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8")
  } catch {
    // ignore
  }
}

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"))
    if (typeof pkg?.version === "string") return pkg.version
  } catch {
    // ignore
  }
  return "unknown"
}

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = String(dataUrl).match(/^data:([^;,]+)?;base64,(.+)$/)
  if (!match) throw new Error("Annotation screenshot must be a base64 data URL")
  return { mime: match[1] || "application/octet-stream", bytes: Buffer.from(match[2], "base64") }
}

function sanitizeFileStem(value: string): string {
  return (
    String(value || "annotation")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "annotation"
  )
}

function saveScreenshot(annotation: any): string | null {
  const dataUrl = annotation?.screenshot?.dataUrl
  if (!dataUrl) return null
  mkdirSync(ANNOTATION_DIR, { recursive: true })
  const { mime, bytes } = decodeDataUrl(dataUrl)
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png"
  const stem = sanitizeFileStem(annotation?.page?.title || annotation?.element?.tag || "annotation")
  const filePath = join(ANNOTATION_DIR, `${Date.now()}-${stem}.${ext}`)
  writeFileSync(filePath, bytes)
  return filePath
}

function formatAnnotation(entry: QueuedAnnotation, index: number): string {
  const { annotation } = entry
  const page = annotation?.page || {}
  const element = annotation?.element || {}
  const rect = element?.rect || {}
  const comment = typeof annotation?.comment === "string" ? annotation.comment.trim() : ""

  const lines = [
    `## Annotation ${index + 1} (${entry.receivedAt})`,
    "",
    comment || "(no comment provided)",
    "",
    `- Page: ${page.title || "(untitled)"} — ${page.url || ""}`,
    `- Element: <${element.tag || "?"}>${element.role ? ` role=${element.role}` : ""}${element.id ? ` id=${element.id}` : ""}`,
    `- Selector: ${element.selector || ""}`,
  ]
  if (element.className) lines.push(`- Class: ${element.className}`)
  if (element.ariaLabel) lines.push(`- Aria label: ${element.ariaLabel}`)
  if (element.text) lines.push(`- Text: ${String(element.text).slice(0, 300)}`)
  lines.push(`- Rect: x=${rect.x ?? "?"} y=${rect.y ?? "?"} w=${rect.width ?? "?"} h=${rect.height ?? "?"}`)
  if (entry.screenshotPath) lines.push(`- Screenshot: ${entry.screenshotPath}`)
  return lines.join("\n")
}

function cleanExtensionVersion(value: any): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function rememberClaim(tabId: number, claimedSessionId: string, extensionVersion?: string): void {
  const now = new Date().toISOString()
  const prior = claims.get(tabId)
  const cleanVersion = cleanExtensionVersion(extensionVersion)
  if (cleanVersion) lastExtensionVersion = cleanVersion
  claims.set(tabId, {
    sessionId: claimedSessionId,
    claimedAt: prior?.claimedAt || now,
    lastSeenAt: now,
    extensionVersion: cleanVersion || prior?.extensionVersion,
  })
}

function listClaims(): Array<Record<string, any>> {
  const cutoff = Date.now() - CLAIM_TTL_MS
  for (const [tabId, claim] of claims.entries()) {
    const lastSeen = Date.parse(claim.lastSeenAt)
    if (!Number.isFinite(lastSeen) || lastSeen < cutoff) claims.delete(tabId)
  }
  return Array.from(claims.entries())
    .map(([tabId, info]) => ({ tabId, ...info }))
    .sort((a, b) => a.tabId - b.tabId)
}

function buildStatus(): Record<string, any> {
  return {
    app: APP_ID,
    version: getPackageVersion(),
    instanceId: sessionId,
    sessionId,
    label: sessionLabel,
    directory,
    runtimeBaseDir: BASE_DIR,
    annotationDir: ANNOTATION_DIR,
    logPath: LOG_PATH,
    server: { status: serverStatus, host: LISTEN_HOST, port: listeningPort, startupError: serverError },
    port: listeningPort,
    lastExtensionVersion,
    claimTtlMs: CLAIM_TTL_MS,
    claims: listClaims(),
    queued: queue.length,
  }
}

function json(res: any, statusCode: number, body: any, origin?: string): void {
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin)
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "content-type")
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.statusCode = statusCode
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: any): Promise<any> {
  return await new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8")
      if (data.length > 10 * 1024 * 1024) reject(new Error("Request body too large"))
    })
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error("Invalid JSON body"))
      }
    })
    req.on("error", reject)
  })
}

function handleRequest(port: number) {
  return async (req: any, res: any) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "*"
    if (req.method === "OPTIONS") {
      json(res, 200, { ok: true }, origin)
      return
    }

    try {
      const url = new URL(req.url || "/", `http://${LISTEN_HOST}:${port}`)

      if (req.method === "GET" && url.pathname === "/status") {
        json(res, 200, buildStatus(), origin)
        return
      }

      // One server process per agent session, so there is exactly one session.
      if (req.method === "GET" && url.pathname === "/sessions") {
        json(res, 200, { sessions: [{ id: sessionId, title: sessionLabel, directory, status: "open" }] }, origin)
        return
      }

      if (req.method === "POST" && url.pathname === "/claim") {
        const body = await readJsonBody(req)
        if (!Number.isFinite(body?.tabId)) throw new Error("tabId is required")
        if (typeof body?.sessionId !== "string" || !body.sessionId) throw new Error("sessionId is required")
        rememberClaim(Number(body.tabId), body.sessionId, body?.extensionVersion)
        json(res, 200, { ok: true, sessionId: body.sessionId }, origin)
        return
      }

      if (req.method === "POST" && url.pathname === "/annotation") {
        const body = await readJsonBody(req)
        if (!Number.isFinite(body?.tabId)) throw new Error("tabId is required")
        if (typeof body?.sessionId !== "string" || !body.sessionId) throw new Error("sessionId is required")
        if (!body?.annotation || typeof body.annotation !== "object") throw new Error("annotation is required")

        rememberClaim(Number(body.tabId), body.sessionId, body?.extensionVersion)
        queue.push({
          receivedAt: new Date().toISOString(),
          tabId: Number(body.tabId),
          annotation: body.annotation,
          screenshotPath: saveScreenshot(body.annotation),
        })
        while (queue.length > QUEUE_LIMIT) queue.shift()
        logDebug(`annotation queued tab=${body.tabId} depth=${queue.length}`)
        json(res, 200, { ok: true, sessionId: body.sessionId, queued: queue.length }, origin)
        return
      }

      if (req.method === "POST" && url.pathname === "/unclaim") {
        const body = await readJsonBody(req)
        const cleanVersion = cleanExtensionVersion(body?.extensionVersion)
        if (cleanVersion) lastExtensionVersion = cleanVersion
        if (!Number.isFinite(body?.tabId)) throw new Error("tabId is required")
        claims.delete(Number(body.tabId))
        json(res, 200, { ok: true }, origin)
        return
      }

      json(res, 404, { ok: false, error: "Not found" }, origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logDebug(`http error path=${req.url || ""} error=${message}`)
      json(res, 400, { ok: false, error: message }, origin)
    }
  }
}

async function startHttpServer(): Promise<void> {
  for (let port = PORT_START; port <= PORT_END; port++) {
    const server = createServer(handleRequest(port))
    const started = await new Promise<boolean>((resolve) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        logDebug(`bind failed port=${port} code=${error.code || ""}`)
        resolve(false)
      })
      server.listen(port, LISTEN_HOST, () => resolve(true))
    })
    if (!started) continue
    httpServer = server
    listeningPort = port
    serverStatus = "listening"
    logDebug(`listening port=${port} session=${sessionId} dir=${directory}`)
    return
  }

  serverStatus = "failed"
  serverError = `Could not bind on ${LISTEN_HOST} ports ${PORT_START}-${PORT_END}`
  throw new Error(serverError)
}

const mcp = new McpServer({ name: APP_ID, version: getPackageVersion() })

mcp.registerTool(
  "get_annotations",
  {
    title: "Get browser annotations",
    description:
      "Drain pending browser annotations left by the user. Each one has a comment, the DOM element it was anchored to, page URL, and a screenshot file path. Call this when the user refers to feedback they left in the browser.",
    inputSchema: {},
  },
  async () => {
    const drained = queue.splice(0, queue.length)
    if (!drained.length) {
      const hint =
        serverStatus === "listening"
          ? `No pending annotations. Server is listening on port ${listeningPort}; connect a tab from the extension and annotate.`
          : `No pending annotations. Annotation server is ${serverStatus}${serverError ? `: ${serverError}` : ""}.`
      return { content: [{ type: "text" as const, text: hint }] }
    }
    logDebug(`drained ${drained.length} annotation(s)`)
    const body = drained.map(formatAnnotation).join("\n\n")
    return {
      content: [
        {
          type: "text" as const,
          text: `${drained.length} annotation(s) from the browser. Read the screenshot paths with the Read tool if you need the visual.\n\n${body}`,
        },
      ],
    }
  }
)

startHttpServer().catch((error) => {
  serverStatus = "failed"
  serverError = error instanceof Error ? error.message : String(error)
  logDebug(`startup failed: ${serverError}`)
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer?.close()
    process.exit(0)
  })
}

await mcp.connect(new StdioServerTransport())
