globalThis.__opc_h = function h(tag: string, { text, style, attrs, on }: OpcElementOptions = {}, children: Node[] = []) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (style) node.style.cssText = style
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value))
    }
  }
  if (on) {
    for (const [eventName, handler] of Object.entries(on)) {
      node.addEventListener(eventName, handler)
    }
  }
  for (const child of children) {
    if (child) node.appendChild(child)
  }
  return node
}

// The collapsed pill has two renderers' worth of history: it used to be built
// both here-ish (on first connect) and by the session picker, and only one of
// them grew a close button. One renderer now, used by both.
globalThis.__opc_renderPill = function renderPill(overlay: HTMLElement, labelText: string) {
  const h = globalThis.__opc_h!
  const makeDockable = globalThis.__opc_makeDockable!
  if (typeof h !== "function" || typeof makeDockable !== "function") {
    throw new Error("Annotation UI helpers are unavailable")
  }

  const STYLE = {
    pill: [
      "position:fixed",
      "left:50%",
      "z-index:2147483647",
      "transform:translateX(-50%)",
      "display:flex",
      "align-items:center",
      "gap:8px",
      "padding:6px 8px 6px 10px",
      "border-radius:999px",
      "background:rgba(15,23,42,0.92)",
      "color:#bbf7d0",
      "border:1px solid rgba(34,197,94,0.45)",
      "box-shadow:0 8px 24px rgba(0,0,0,0.22)",
      "font:12px/1.2 ui-sans-serif,system-ui,sans-serif",
      "pointer-events:auto",
      "backdrop-filter:blur(8px)",
      "cursor:grab",
      "user-select:none",
      "-webkit-user-select:none",
    ].join(";"),
    label: "font-weight:600;",
    primary:
      "border:0;border-radius:999px;padding:4px 8px;background:#22c55e;color:#052e16;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;",
    secondary:
      "border:1px solid rgba(34,197,94,0.45);border-radius:999px;padding:3px 8px;background:transparent;color:#bbf7d0;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;",
    close:
      "display:inline-flex;align-items:center;justify-content:center;border:0;padding:0 2px;background:transparent;color:#bbf7d0;cursor:pointer;",
  }

  function send(type: string) {
    return (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      try {
        chrome.runtime.sendMessage({ type })
      } catch {}
    }
  }

  function closeIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 12 12")
    svg.setAttribute("width", "12")
    svg.setAttribute("height", "12")
    svg.setAttribute("aria-hidden", "true")

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", "M2 2 L10 10 M10 2 L2 10")
    path.setAttribute("stroke", "currentColor")
    path.setAttribute("stroke-width", "1.8")
    path.setAttribute("stroke-linecap", "round")
    svg.appendChild(path)
    return svg
  }

  overlay.innerHTML = ""
  overlay.style.cssText = STYLE.pill
  makeDockable(overlay, { blockDragSelector: "button", snapThreshold: 10 }).applyDockPosition(overlay.dataset.dock)

  overlay.appendChild(h("span", { text: labelText, style: STYLE.label, attrs: { "data-role": "label" } }))
  overlay.appendChild(
    h("button", {
      text: "Annotate",
      style: STYLE.primary,
      attrs: { type: "button", title: "Pick an element and comment on it" },
      on: { click: send("start_annotation_from_overlay") },
    })
  )
  overlay.appendChild(
    h("button", {
      text: "Capture",
      style: STYLE.secondary,
      attrs: { type: "button", title: "Comment on a screenshot of the whole page" },
      on: { click: send("start_capture_from_overlay") },
    })
  )
  overlay.appendChild(
    h(
      "button",
      {
        style: STYLE.close,
        attrs: { type: "button", "aria-label": "Disconnect tab", title: "Disconnect this tab" },
        on: { click: send("disconnect_tab") },
      },
      [closeIcon()]
    )
  )
}

globalThis.__opc_makeDockable = function makeDockable(overlay: HTMLElement, options = {}) {
  if (!overlay) throw new Error("overlay is required")
  if (overlay.__opcDockApi) return overlay.__opcDockApi

  const blockDragSelector = options.blockDragSelector || "button"
  const snapThreshold = Number.isFinite(options.snapThreshold) ? options.snapThreshold : 10

  let dragging = false
  let pointerId: number | null = null
  let offsetX = 0
  let offsetY = 0

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  function applyDockPosition(dock?: string): void {
    const next = dock === "bottom" ? "bottom" : "top"
    overlay.dataset.dock = next
    overlay.style.left = "50%"
    overlay.style.transform = "translateX(-50%)"
    if (next === "bottom") {
      overlay.style.top = ""
      overlay.style.bottom = `${snapThreshold}px`
    } else {
      overlay.style.bottom = ""
      overlay.style.top = `${snapThreshold}px`
    }
  }

  overlay.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest(blockDragSelector)) return
    event.preventDefault()
    dragging = true
    pointerId = event.pointerId
    const rect = overlay.getBoundingClientRect()
    offsetX = event.clientX - rect.left
    offsetY = event.clientY - rect.top
    overlay.style.cursor = "grabbing"
    overlay.setPointerCapture(pointerId)
  })

  overlay.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return
    event.preventDefault()
    const rect = overlay.getBoundingClientRect()
    const nextLeft = clamp(event.clientX - offsetX, 8, window.innerWidth - rect.width - 8)
    const nextTop = clamp(event.clientY - offsetY, 8, window.innerHeight - rect.height - 8)
    overlay.style.left = `${Math.round(nextLeft)}px`
    overlay.style.transform = ""
    overlay.style.bottom = ""
    overlay.style.top = `${Math.round(nextTop)}px`
  })

  overlay.addEventListener("pointerup", (event: PointerEvent) => {
    if (!dragging) return
    dragging = false
    applyDockPosition(event.clientY > window.innerHeight / 2 ? "bottom" : "top")
    overlay.style.cursor = "grab"
    if (pointerId !== null) {
      try {
        overlay.releasePointerCapture(pointerId)
      } catch {}
    }
    pointerId = null
  })

  overlay.addEventListener("pointercancel", () => {
    dragging = false
    pointerId = null
    overlay.style.cursor = "grab"
  })

  overlay.__opcDockApi = { applyDockPosition }
  return overlay.__opcDockApi
}
