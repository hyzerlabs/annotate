import { warnExtension } from "./logger.js"
import type { TabClaim } from "./types.js"

export async function injectConnectionOverlay(tabId: number, claim?: TabClaim): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      files: ["injected/dom.js"],
    })

    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      args: [
        claim?.sessionLabel || claim?.sessionId || "agent session",
        claim?.queued || 0,
        claim?.persistQueue === true,
        claim?.position || null,
      ],
      func: (sessionLabel: string, queued: number, persistQueue: boolean, position: OpcPosition | null) => {
        const shadow = globalThis.__opc_shadow
        const renderPill = globalThis.__opc_renderPill
        if (typeof shadow !== "function" || typeof renderPill !== "function") {
          throw new Error("Annotation UI helpers are unavailable")
        }
        const { host, root } = shadow("__opc_connection_overlay", "dock")
        renderPill(root, host, sessionLabel, queued, persistQueue, position)
      },
    })
  } catch (error) {
    warnExtension("Failed to inject connection overlay", { tabId, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Updates the pill's queue badge in place — no re-render, no dock reset. */
export async function setConnectionOverlayQueue(tabId: number, queued: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      args: [queued],
      func: (count: number) => {
        const badge = document
          .getElementById("__opc_connection_overlay")
          ?.shadowRoot?.querySelector("[data-role='queue']") as HTMLElement | null
        if (badge) globalThis.__opc_setQueueBadge?.(badge, count)
      },
    })
  } catch {
    // Tab may have closed or the pill may not be mounted yet.
  }
}

// Keeps our own chrome out of the screenshot. Resolves after two frames so the
// hidden state has actually painted before captureVisibleTab reads the tab.
export async function setConnectionOverlayHidden(tabId: number, hidden: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      args: [hidden],
      func: (hide: boolean) => {
        const overlay = document.getElementById("__opc_connection_overlay")
        if (overlay) overlay.style.visibility = hide ? "hidden" : ""
        return new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
      },
    })
  } catch {
    // Tab may have closed or disallow injection.
  }
}

export async function removeConnectionOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        document.getElementById("__opc_connection_overlay")?.remove()
      },
    })
  } catch {
    // Tab may have closed or disallow injection.
  }
}

export async function showAnnotationError(tabId: number, message: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["injected/dom.js"],
  })
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [message],
    func: (errorMessage: string) => {
      const h = globalThis.__opc_h!
      const shadow = globalThis.__opc_shadow!
      if (typeof h !== "function" || typeof shadow !== "function") return

      document.getElementById("__opc_annotation_error")?.remove()
      const { host, root } = shadow("__opc_annotation_error", "picker")

      const toast = h("div", { attrs: { class: "surface toast" } }, [
        h("div", { text: "Annotation failed", attrs: { class: "toast-title" } }),
        h("div", { text: errorMessage, attrs: { class: "toast-body" } }),
      ])
      root.replaceChildren(toast)

      requestAnimationFrame(() => toast.setAttribute("data-shown", ""))
      setTimeout(() => {
        toast.removeAttribute("data-shown")
        setTimeout(() => host.remove(), 300)
      }, 7000)
    },
  })
}
