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
        claim?.position || null,
      ],
      func: (sessionLabel: string, queued: number, position: OpcPosition | null) => {
        const shadow = globalThis.__opc_shadow
        const renderPill = globalThis.__opc_renderPill
        if (typeof shadow !== "function" || typeof renderPill !== "function") {
          throw new Error("Annotation UI helpers are unavailable")
        }
        const { host, root } = shadow("__opc_connection_overlay", "dock")
        renderPill(root, host, sessionLabel, queued, position)
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

/**
 * Hides our own chrome — the pill and the settings popup — but only the parts
 * that would actually appear in what we are about to capture, and reports
 * whether anything was hidden.
 *
 * `region` is the area being captured in viewport CSS pixels, or null for the
 * whole page. Element crops usually do not include the pill at all, and hiding
 * it regardless made it vanish and return on every send — a flash with nothing
 * behind it. Resolves after two frames so the hidden state has painted before
 * captureVisibleTab reads the tab.
 */
export async function hideOverlayForCapture(
  tabId: number,
  region: { left: number; top: number; right: number; bottom: number } | null
): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      args: [region],
      func: (area: { left: number; top: number; right: number; bottom: number } | null) => {
        const overlays = ["__opc_connection_overlay", "__opc_settings_root"]
          .map((id) => document.getElementById(id))
          .filter((overlay): overlay is HTMLElement => {
            if (!overlay) return false
            if (!area) return true
            const rect = overlay.getBoundingClientRect()
            return rect.left < area.right && rect.right > area.left && rect.top < area.bottom && rect.bottom > area.top
          })
        if (!overlays.length) return false

        for (const overlay of overlays) overlay.style.visibility = "hidden"
        return new Promise<boolean>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
        })
      },
    })
    return injection?.result === true
  } catch {
    return false // tab closed or injection refused; nothing was hidden
  }
}

/** Puts back whatever hideOverlayForCapture hid; unconditional, so it is safe
 * to call when nothing was hidden. */
export async function showConnectionOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        for (const id of ["__opc_connection_overlay", "__opc_settings_root"]) {
          const overlay = document.getElementById(id)
          if (overlay) overlay.style.visibility = ""
        }
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
        // The settings popup is a sibling of the pill now, so it has to go with
        // it — a disconnected tab keeping a floating settings panel is chrome
        // for a connection that no longer exists.
        globalThis.__opc_cleanupSettings?.()
        document.getElementById("__opc_settings_root")?.remove()
        document.getElementById("__opc_connection_overlay")?.remove()
      },
    })
  } catch {
    // Tab may have closed or disallow injection.
  }
}

type ToastOptions = { title: string; body?: string; intent?: "success" | "danger"; durationMs?: number }

export async function showToast(tabId: number, options: ToastOptions): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["injected/dom.js"],
  })
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [options],
    func: (toastOptions: ToastOptions) => {
      const h = globalThis.__opc_h!
      const shadow = globalThis.__opc_shadow!
      if (typeof h !== "function" || typeof shadow !== "function") return

      // A single toast host, replaced rather than stacked: two of these landing
      // on top of each other reads as a glitch.
      document.getElementById("__opc_annotation_toast")?.remove()
      const { host, root } = shadow("__opc_annotation_toast", "picker")

      const toast = h("div", {
        attrs: { class: "surface toast", "data-intent": toastOptions.intent || "danger" },
      }, [
        h("div", { text: toastOptions.title, attrs: { class: "toast-title" } }),
        ...(toastOptions.body ? [h("div", { text: toastOptions.body, attrs: { class: "toast-body" } })] : []),
      ])
      root.replaceChildren(toast)

      // Land next to the pill, where the composer just was.
      const pill = document.getElementById("__opc_connection_overlay")
      const anchorTo = globalThis.__opc_anchorTo
      if (pill?.isConnected && typeof anchorTo === "function") {
        const { left, top } = anchorTo(pill, toast)
        toast.style.right = "auto"
        toast.style.bottom = "auto"
        toast.style.left = `${Math.round(left)}px`
        toast.style.top = `${Math.round(top)}px`
      }

      // Forcing a style flush is what makes the transition run. A single
      // requestAnimationFrame can fire before the initial style is computed, so
      // the element jumps straight to the shown state — which read as a flash
      // rather than an appearance.
      void toast.offsetWidth
      toast.setAttribute("data-shown", "")

      setTimeout(() => {
        toast.removeAttribute("data-shown")
        setTimeout(() => host.remove(), 300)
      }, toastOptions.durationMs || 7000)
    },
  })
}

export async function showAnnotationError(tabId: number, message: string, title = "Annotation failed"): Promise<void> {
  await showToast(tabId, { title, body: message, intent: "danger" })
}
