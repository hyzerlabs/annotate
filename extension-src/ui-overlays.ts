import { warnExtension } from "./logger.js"

export async function injectConnectionOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      files: ["injected/dom.js"],
    })

    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        const renderPill = globalThis.__opc_renderPill
        if (typeof renderPill !== "function") {
          throw new Error("Annotation pill helper is unavailable")
        }

        let overlay = document.getElementById("__opc_connection_overlay")
        if (!overlay) {
          overlay = document.createElement("div")
          overlay.id = "__opc_connection_overlay"
          document.documentElement.appendChild(overlay)
        }
        renderPill(overlay, "Connected")
      },
    })
  } catch (error) {
    warnExtension("Failed to inject connection overlay", { tabId, error: error instanceof Error ? error.message : String(error) })
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
    args: [message],
    func: (errorMessage: string) => {
      const existing = document.getElementById("__opc_annotation_error")
      if (existing) existing.remove()

      const panel = document.createElement("div")
      panel.id = "__opc_annotation_error"
      panel.textContent = `Annotation failed: ${errorMessage}`
      panel.style.cssText = [
        "position:fixed",
        "right:16px",
        "bottom:16px",
        "z-index:2147483647",
        "max-width:360px",
        "padding:12px 14px",
        "border-radius:10px",
        "background:#7f1d1d",
        "color:#fee2e2",
        "border:1px solid rgba(254,202,202,0.45)",
        "box-shadow:0 10px 30px rgba(0,0,0,0.35)",
        "font:13px/1.4 ui-sans-serif,system-ui,sans-serif",
        "transform:translateX(calc(100% + 40px))",
        "opacity:0",
        "transition:transform 180ms cubic-bezier(.2,.8,.2,1), opacity 160ms ease",
      ].join(";")
      document.documentElement.appendChild(panel)
      requestAnimationFrame(() => {
        panel.style.transform = "translateX(0)"
        panel.style.opacity = "1"
      })
      setTimeout(() => {
        panel.style.transform = "translateX(calc(100% + 40px))"
        panel.style.opacity = "0"
        setTimeout(() => panel.remove(), 220)
      }, 7000)
    },
  })
}
