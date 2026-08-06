import {
  CONNECTION_CHECK_INTERVAL_MS,
  CONNECTION_STATUS_TIMEOUT_MS,
} from "./constants.js"
import { fetchServerStatus, postJson } from "./server-api.js"
import { warnExtension } from "./logger.js"
import type { ClaimsStore, TabClaim } from "./types.js"

type ConnectionMonitorOptions = {
  claimedTabs: ClaimsStore
  removeConnectionOverlay(tabId: number): Promise<void>
  setConnectionOverlayQueue(tabId: number, queued: number): Promise<void>
  extensionVersion: string
}

export function createConnectionMonitor({
  claimedTabs,
  removeConnectionOverlay,
  setConnectionOverlayQueue,
  extensionVersion,
}: ConnectionMonitorOptions) {
  let timer: ReturnType<typeof setInterval> | null = null

  function heartbeatClaim(tabId: number, claim: TabClaim): Promise<unknown> | null {
    if (!claim?.baseUrl || !claim?.sessionId) return null
    return postJson(claim.baseUrl, "/claim", {
      tabId,
      sessionId: claim.sessionId,
      extensionVersion,
    })
  }

  function stop() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  function ensure() {
    if (timer !== null) return
    timer = setInterval(() => {
      check().catch(() => {})
    }, CONNECTION_CHECK_INTERVAL_MS)
  }

  async function check() {
    if (!claimedTabs.size()) {
      stop()
      return
    }

    const baseUrls = new Set<string>()
    for (const claim of claimedTabs.values()) {
      if (claim?.baseUrl) baseUrls.add(claim.baseUrl)
    }

    const settled = await Promise.allSettled(
      Array.from(baseUrls).map(async (baseUrl) => ({
        baseUrl,
        status: await fetchServerStatus(baseUrl, CONNECTION_STATUS_TIMEOUT_MS),
      }))
    )

    const disconnected = new Set<string>()
    const queueDepths = new Map<string, number>()
    for (const result of settled) {
      if (result.status !== "fulfilled") continue
      const { baseUrl, status } = result.value
      if (!status) {
        disconnected.add(baseUrl)
        continue
      }
      if (Number.isFinite(status.queued)) queueDepths.set(baseUrl, Number(status.queued))
    }

    await Promise.allSettled(
      Array.from(claimedTabs.entries()).map(([tabId, claim]) => {
        if (disconnected.has(claim?.baseUrl)) return null
        return heartbeatClaim(tabId, claim)
      })
    )

    // The queue also empties when the agent drains it, which nothing else in
    // the extension observes — this poll is the only way the badge gets back
    // to zero.
    await Promise.allSettled(
      Array.from(claimedTabs.entries()).map(async ([tabId, claim]) => {
        const queued = queueDepths.get(claim?.baseUrl)
        if (queued === undefined || queued === claim.queued) return
        claimedTabs.set(tabId, { ...claim, queued })
        await setConnectionOverlayQueue(tabId, queued)
      })
    )

    if (!disconnected.size) return

    for (const [tabId, claim] of claimedTabs.entries()) {
      if (!disconnected.has(claim?.baseUrl)) continue
      claimedTabs.delete(tabId)
      await removeConnectionOverlay(tabId)
    }

    warnExtension("Lost connection to annotation server", {
      disconnectedInstances: Array.from(disconnected),
      remainingClaims: claimedTabs.size(),
    })

    if (!claimedTabs.size()) stop()
  }

  return { ensure, stop, check }
}
