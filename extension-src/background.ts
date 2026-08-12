import { logExtension, warnExtension } from "./logger.js"
import { getActiveTab } from "./tabs.js"
import { postJson, requestSessionState } from "./server-api.js"
import {
  injectConnectionOverlay,
  removeConnectionOverlay,
  hideOverlayForCapture,
  setConnectionOverlayQueue,
  showConnectionOverlay,
  showAnnotationError,
  showToast,
} from "./ui-overlays.js"
import { showSessionPicker } from "./session-picker.js"
import { showSettingsPanel } from "./settings-panel.js"
import { runAnnotationPicker } from "./annotation-picker.js"
import { captureElement, captureFullPage } from "./capture.js"
import { CAPTURE_ELEMENT_PADDING_PX, OUTLINE_COLOR_KEY } from "./constants.js"
import { createConnectionMonitor } from "./connection-monitor.js"
import { createClaimsStore } from "./claims-store.js"
import type {
  AnnotationMode,
  AnnotationPayload,
  AnnotationScreenshot,
  ExtensionMessage,
  SessionInfo,
  SettingsState,
  TabClaim,
} from "./types.js"

const claimedTabs = createClaimsStore()
const extensionVersion = chrome.runtime.getManifest().version

const monitor = createConnectionMonitor({
  claimedTabs,
  removeConnectionOverlay,
  setConnectionOverlayQueue,
  injectConnectionOverlay,
  extensionVersion,
})

// Our own overlay hosts. Annotating one of these makes it the subject of the
// screenshot, so the usual "hide our chrome before the shutter" rule inverts:
// hiding it crops the empty page behind the thing being annotated, which is
// how a comment on the pill came back as a black rectangle.
const OVERLAY_HOST_IDS = [
  "__opc_connection_overlay",
  "__opc_settings_root",
  "__opc_annotation_toast",
  "__opc_annotation_root",
]

const MESSAGE_TYPE = {
  START_ANNOTATION: "start_annotation_from_overlay",
  START_CAPTURE: "start_capture_from_overlay",
  CONNECT_TAB: "connect_tab_to_session",
  DISCONNECT_TAB: "disconnect_tab",
  REFRESH_SESSIONS: "refresh_sessions",
  OVERLAY_MOVED: "overlay_moved",
  SET_PERSIST_QUEUE: "set_persist_queue",
  OPEN_SETTINGS: "open_settings",
  OPEN_SHORTCUTS: "open_shortcuts",
  SET_OUTLINE_COLOR: "set_outline_color",
} as const

const COMMAND_MODE: Record<string, AnnotationMode> = { annotate: "element", capture: "page" }

function isSupportedMessage(message: unknown): message is ExtensionMessage {
  const type = typeof message === "object" && message !== null ? (message as { type?: unknown }).type : undefined
  return typeof type === "string" && (Object.values(MESSAGE_TYPE) as string[]).includes(type)
}

function toOriginPattern(url?: string): string | null {
  if (typeof url !== "string" || !url) return null
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return null
    return `${parsed.origin}/*`
  } catch {
    return null
  }
}

function sessionLabel(session: Pick<SessionInfo, "id" | "title">): string {
  return session?.title || session?.id
}

function claimRequestBody(tabId: number, sessionId: string) {
  return { tabId, sessionId, extensionVersion }
}

async function ensureSiteAccess(tab: chrome.tabs.Tab): Promise<void> {
  if (!chrome.permissions?.request) return

  const origin = toOriginPattern(tab?.url)
  if (!origin) {
    throw new Error("This page cannot be annotated. Open an http(s) page and try again.")
  }

  const granted = await chrome.permissions.request({ origins: [origin] })
  if (!granted) {
    throw new Error("Site access was denied for this page.")
  }
}

async function settingsState(tabId: number): Promise<SettingsState> {
  const commands = await chrome.commands.getAll().catch((): chrome.commands.Command[] => [])
  const stored = await chrome.storage.local.get(OUTLINE_COLOR_KEY)
  return {
    persistQueue: claimedTabs.get(tabId)?.persistQueue === true,
    outlineColor: typeof stored[OUTLINE_COLOR_KEY] === "string" ? stored[OUTLINE_COLOR_KEY] : null,
    shortcuts: commands
      .filter((command) => command.name && command.name in COMMAND_MODE)
      .map((command) => ({
        name: command.name!,
        label: command.description || command.name!,
        shortcut: command.shortcut || "",
      })),
  }
}

async function runMessageAction(message: ExtensionMessage, tab: chrome.tabs.Tab) {
  if (message.type === "connect_tab_to_session") {
    logExtension("Session picker selection received", {
      tabId: tab?.id,
      sessionId: message.session?.id,
      sessionLabel: sessionLabel(message.session),
    })
    await claimTabForSession(tab, message.session)
    return { ok: true }
  }

  if (message.type === "disconnect_tab") {
    const disconnected = await disconnectTab(tab)
    return { ok: true, disconnected }
  }

  if (message.type === "overlay_moved") {
    // Stored on the claim, which already persists to chrome.storage.session,
    // so a reload or navigation re-injects the pill where it was left.
    const claim = claimedTabs.get(tab?.id)
    if (claim && tab.id) claimedTabs.set(tab.id, { ...claim, position: message.position })
    return { ok: true }
  }

  if (message.type === "set_persist_queue") {
    const claim = claimedTabs.get(tab?.id)
    if (!claim?.baseUrl) throw new Error("Tab is not connected to an annotation server")
    try {
      await postJson(claim.baseUrl, "/settings", { persistQueue: message.persistQueue })
    } catch (error) {
      // The server predates /settings. Restarting the agent is the fix, and
      // saying "404" instead would send people looking for a network problem.
      const text = error instanceof Error ? error.message : String(error)
      if (text.includes("404")) {
        throw new Error("This agent's annotation server is older than the queue setting. Restart the agent to pick it up.")
      }
      throw error
    }
    // The setting is per server, so every tab pointed at it re-renders.
    await syncTabsOnServer(claim.baseUrl, { persistQueue: message.persistQueue })
    logExtension("Queue persistence changed", { baseUrl: claim.baseUrl, persistQueue: message.persistQueue })
    return { ok: true, persistQueue: message.persistQueue }
  }

  if (message.type === "open_settings") {
    if (!tab.id) throw new Error("No active tab found")
    await showSettingsPanel(tab.id, await settingsState(tab.id))
    return { ok: true }
  }

  if (message.type === "set_outline_color") {
    // Removed rather than stored as null, so "unset" is the absence of a value
    // and the highlight falls back to the theme token.
    if (message.color) await chrome.storage.local.set({ [OUTLINE_COLOR_KEY]: message.color })
    else await chrome.storage.local.remove(OUTLINE_COLOR_KEY)
    return { ok: true }
  }

  if (message.type === "open_shortcuts") {
    // Only Chrome can rebind an extension command, on its own page — a panel
    // that recorded keystrokes would have nowhere to put them.
    await chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
    return { ok: true }
  }

  if (message.type === "refresh_sessions") {
    const { sessions, context } = await requestSessionState()
    if (!tab.id) throw new Error("No active tab found")
    await showSessionPicker(tab.id, sessions, context)
    return { ok: true, sessions: sessions.length }
  }

  const mode: AnnotationMode = message.type === "start_capture_from_overlay" ? "page" : "element"
  const result = await startAnnotationMode(tab, mode)
  return { ok: true, cancelled: !!result?.cancelled }
}

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender) {
  const tab = sender.tab?.id ? sender.tab : await getActiveTab()

  try {
    return await runMessageAction(message, tab)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (message.type === "connect_tab_to_session") {
      warnExtension("Failed to connect tab to agent session", {
        tabId: tab?.id,
        sessionId: message.session?.id,
        error: text,
      })
    }
    const title = message.type === "set_persist_queue" ? "Could not change the setting" : "Annotation failed"
    if (tab?.id) await showAnnotationError(tab.id, text, title).catch(() => {})
    return { ok: false, error: text }
  }
}

/**
 * Server-scoped state (queue depth, persistence) applies to every tab pointed
 * at that server, not just the one that changed it. Re-injects rather than
 * patching, because these change the pill's structure.
 */
async function syncTabsOnServer(baseUrl: string, patch: Partial<TabClaim>): Promise<void> {
  await Promise.allSettled(
    Array.from(claimedTabs.entries()).map(async ([tabId, claim]) => {
      if (claim.baseUrl !== baseUrl) return
      const next = { ...claim, ...patch }
      claimedTabs.set(tabId, next)
      await injectConnectionOverlay(tabId, next)
    })
  )
}

async function claimTabForSession(tab: chrome.tabs.Tab, session: SessionInfo): Promise<void> {
  if (!tab.id) throw new Error("No active tab found")
  logExtension("Connecting tab to agent session", {
    tabId: tab?.id,
    sessionId: session?.id,
    sessionLabel: sessionLabel(session),
    baseUrl: session?.baseUrl,
  })

  await postJson(session.baseUrl, "/claim", claimRequestBody(tab.id, session.id))

  const claim = {
    sessionId: session.id,
    sessionLabel: sessionLabel(session),
    baseUrl: session.baseUrl,
    origin: toOriginPattern(tab.url),
    extensionVersion,
    queued: Number.isFinite(session.queued) ? Number(session.queued) : 0,
    persistQueue: session.persistQueue === true,
  }
  claimedTabs.set(tab.id, claim)

  await injectConnectionOverlay(tab.id, claim)
  monitor.ensure()

  logExtension("Connected tab to agent session", {
    tabId: tab?.id,
    sessionId: session?.id,
    sessionLabel: sessionLabel(session),
    baseUrl: session?.baseUrl,
  })
}

async function disconnectTab(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.id) return false
  const claim = claimedTabs.get(tab?.id)
  if (!claim) return false

  if (claim?.baseUrl && claim?.sessionId) {
    try {
      await postJson(claim.baseUrl, "/unclaim", claimRequestBody(tab.id, claim.sessionId))
    } catch (error) {
      warnExtension("Failed to clear upstream tab claim", {
        tabId: tab?.id,
        sessionId: claim?.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  claimedTabs.delete(tab.id)
  await removeConnectionOverlay(tab.id)
  if (!claimedTabs.size()) monitor.stop()

  logExtension("Disconnected tab from agent session", {
    tabId: tab?.id,
    sessionId: claim?.sessionId,
  })

  return true
}

async function startAnnotationMode(
  tabOverride: chrome.tabs.Tab | undefined,
  mode: AnnotationMode
): Promise<{ cancelled: boolean }> {
  const tab = tabOverride?.id ? tabOverride : await getActiveTab()
  if (!tab?.id || !tab.windowId) throw new Error("No active tab found")

  logExtension("Starting annotation mode", {
    tabId: tab.id,
    windowId: tab.windowId,
    mode,
    url: tab.url,
    title: tab.title,
  })

  const picked = await runAnnotationPicker(tab.id, mode)
  if (!picked || picked.cancelled === true) return { cancelled: true }

  // Usually nothing is hidden at all, so there is nothing to put back. When the
  // pill did have to go, it stays gone until the toast is ready, so it returns
  // with the confirmation rather than blinking back on its own first.
  let pillHidden = false
  const restorePill = async () => {
    if (!pillHidden) return
    pillHidden = false
    await showConnectionOverlay(tab.id!)
  }

  let screenshot: AnnotationScreenshot | null = null

  try {
    if (picked.includeScreenshot) {
      logExtension("Capturing annotation screenshot", { tabId: tab.id, windowId: tab.windowId, mode })
      // Only hide the pill if it would actually be in frame. An element crop
      // rarely includes it, and hiding it anyway made it disappear and come
      // back on every single send.
      const captureRegion =
        mode === "element" && picked.element
          ? {
              left: picked.element.rect.x - CAPTURE_ELEMENT_PADDING_PX,
              top: picked.element.rect.y - CAPTURE_ELEMENT_PADDING_PX,
              right: picked.element.rect.x + picked.element.rect.width + CAPTURE_ELEMENT_PADDING_PX,
              bottom: picked.element.rect.y + picked.element.rect.height + CAPTURE_ELEMENT_PADDING_PX,
            }
          : null
      const annotatingOurOverlay = !!picked.element?.id && OVERLAY_HOST_IDS.includes(picked.element.id)
      pillHidden = annotatingOurOverlay ? false : await hideOverlayForCapture(tab.id, captureRegion)
      try {
        screenshot =
          mode === "page" || !picked.element
            ? await captureFullPage(tab)
            : await captureElement(tab, picked.element, picked.viewport)
      } finally {
        // The moment the shutter closes. Holding it hidden until the toast made
        // the window several hundred milliseconds longer for no benefit — the
        // toast is not what the eye is tracking while the pill is missing.
        await restorePill()
      }
      logExtension("Captured annotation screenshot", {
        tabId: tab.id,
        mode: screenshot.mode,
        cropped: screenshot.cropped,
        truncated: screenshot.truncated,
        pillHidden,
        bytesApprox: Math.round((screenshot.dataUrl.length * 3) / 4),
      })
    } else {
      logExtension("Screenshot skipped by user", { tabId: tab.id, mode })
    }

    const annotationPayload: AnnotationPayload = {
      comment: picked.comment || "",
      mode,
      page: {
        url: tab.url || "",
        title: tab.title || "",
      },
      element: picked.element,
      viewport: picked.viewport,
      screenshot,
    }

    logExtension("Sending annotation upstream", {
      tabId: tab.id,
      selector: picked.element?.selector,
      commentLength: annotationPayload.comment.length,
    })

    const claim = claimedTabs.get(tab.id)
    if (!claim?.baseUrl || !claim?.sessionId) {
      throw new Error("Tab is not connected to an annotation server")
    }

    const annotationResponse = await postJson<{ sessionId?: string; queued?: number }>(
      claim.baseUrl,
      "/annotation",
      {
        ...claimRequestBody(tab.id, claim.sessionId),
        annotation: annotationPayload,
      }
    )

    logExtension("Annotation accepted by annotation server", {
      tabId: tab.id,
      baseUrl: claim.baseUrl,
      sessionId: annotationResponse?.sessionId,
      queued: annotationResponse?.queued,
    })

    // Confirmed only once the server has it, so it reports delivery rather than
    // intent. Restored alongside the toast so the pill returning and the
    // confirmation arriving are a single moment.
    const queued = Number(annotationResponse?.queued)
    await showToast(tab.id, {
      title: mode === "page" ? "Page comment sent" : "Annotation sent",
      body: Number.isFinite(queued) ? `${queued} waiting for the agent` : undefined,
      intent: "success",
      durationMs: 2500,
    }).catch(() => {})

    if (Number.isFinite(queued)) {
      await Promise.allSettled(
        Array.from(claimedTabs.entries()).map(async ([claimedTabId, claimed]) => {
          if (claimed.baseUrl !== claim.baseUrl) return
          claimedTabs.set(claimedTabId, { ...claimed, queued })
          await setConnectionOverlayQueue(claimedTabId, queued)
        })
      )
    }

    return { cancelled: false }
  } finally {
    // Idempotent, so this is a no-op on the success path. It exists so that no
    // failure between hiding the pill and showing the toast can leave the pill
    // invisible with no way to get it back.
    await restorePill()
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  claimedTabs.delete(tabId)
  if (!claimedTabs.size()) monitor.stop()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return
  const claim = claimedTabs.get(tabId)
  if (!claim) return

  const nextOrigin = toOriginPattern(tab?.url)
  if (nextOrigin && claim.origin && nextOrigin !== claim.origin) {
    disconnectTab({ ...tab, id: tabId }).catch(() => {})
    return
  }

  injectConnectionOverlay(tabId, claim)
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const claim = claimedTabs.get(tabId)
  if (claim) injectConnectionOverlay(tabId, claim)
})

async function restoreClaimState() {
  await claimedTabs.restore()

  for (const [tabId, claim] of Array.from(claimedTabs.entries())) {
    try {
      const tab = await chrome.tabs.get(tabId)
      const nextOrigin = toOriginPattern(tab?.url)
      if (!nextOrigin || (claim.origin && nextOrigin !== claim.origin)) {
        claimedTabs.delete(tabId)
        continue
      }
      await injectConnectionOverlay(tabId, claim)
    } catch {
      claimedTabs.delete(tabId)
    }
  }

  if (claimedTabs.size()) monitor.ensure()
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isSupportedMessage(message)) return false

  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })

  return true
})

chrome.commands.onCommand.addListener(async (command) => {
  const mode = COMMAND_MODE[command]
  if (!mode) return

  try {
    const tab = await getActiveTab()
    // The pill's buttons cannot be pressed on an unconnected tab; a shortcut can,
    // so the check the UI used to make implicitly has to be made here.
    if (!claimedTabs.get(tab?.id)) {
      throw new Error("This tab is not connected to an agent session. Click the extension icon to connect it.")
    }
    await startAnnotationMode(tab, mode)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnExtension("Shortcut failed", { command, error: message })
    const tab = await getActiveTab().catch((): null => null)
    if (tab?.id) await showAnnotationError(tab.id, message).catch(() => {})
  }
})

chrome.action.onClicked.addListener(async (clickedTab) => {
  try {
    const tab = clickedTab?.id ? clickedTab : await getActiveTab()
    if (!tab.id) throw new Error("No active tab found")
    await ensureSiteAccess(tab)
    const { sessions, context } = await requestSessionState()
    await showSessionPicker(tab.id, sessions, context)
    logExtension(sessions.length ? "Session picker shown" : "Setup help shown", undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnExtension("Failed to show session picker", { error: message })
    const tab = await getActiveTab().catch((): null => null)
    if (tab?.id) await showAnnotationError(tab.id, message).catch(() => {})
  }
})

restoreClaimState().catch((error) => {
  warnExtension("Failed to restore tab claims", { error: error instanceof Error ? error.message : String(error) })
})
