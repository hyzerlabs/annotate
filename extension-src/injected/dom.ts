import tokensCss from "@hyzer-labs/ui/tokens.css"
import { anchorPosition } from "../geometry.js"
import { scopeTokensToHost } from "../token-scope.js"
import overlayCss from "./overlay.css"

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

/**
 * An icon from one path, stroked by default. Every overlay was building its own
 * close icon by hand; the third copy was the one that stopped being worth it.
 */
globalThis.__opc_svgIcon = function svgIcon(d: string, options: OpcIconOptions = {}) {
  const { viewBox = "0 0 12 12", size = 11, strokeWidth = 1.6 } = options
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", viewBox)
  svg.setAttribute("width", String(size))
  svg.setAttribute("height", String(size))
  svg.setAttribute("aria-hidden", "true")

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", d)
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", "currentColor")
  path.setAttribute("stroke-width", String(strokeWidth))
  path.setAttribute("stroke-linecap", "round")
  path.setAttribute("stroke-linejoin", "round")
  svg.appendChild(path)
  return svg
}

const CLOSE_ICON_PATH = "M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5"

/**
 * An open-end spanner: a C-shaped jaw with a handle running to the opposite
 * corner. Two strokes and no fill, so it reads as a tool without pulling the
 * eye the way a cog's teeth do at this size — a gear is all high-frequency
 * detail, and at 14px that detail turns into noise.
 */
const WRENCH_ICON_PATH = (() => {
  const HEAD = 8.2
  const RADIUS = 4
  // The jaw opens away from the handle, which runs out at 45° to the corner.
  const HANDLE_ANGLE = 45
  const JAW_HALF_WIDTH = 58
  const at = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180
    return `${(HEAD + Math.cos(radians) * RADIUS).toFixed(2)} ${(HEAD + Math.sin(radians) * RADIUS).toFixed(2)}`
  }

  const start = HANDLE_ANGLE + 180 + JAW_HALF_WIDTH
  const end = HANDLE_ANGLE + 180 - JAW_HALF_WIDTH + 360
  return `M${at(start)} A${RADIUS} ${RADIUS} 0 ${end - start > 180 ? 1 : 0} 1 ${at(end)} M${at(HANDLE_ANGLE)} L19.4 19.4`
})()

let sheet: CSSStyleSheet | null = null

function overlaySheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(`${scopeTokensToHost(tokensCss)}\n${overlayCss}`)
  }
  return sheet
}

/**
 * A shadow root for one of our overlays, keyed by host id. Styles are adopted
 * into the shadow root and the host is reset with `all: initial`, so nothing
 * leaks in either direction between the tool and the page it is annotating.
 *
 * Returns the existing pair if the host is already on the page.
 */
globalThis.__opc_shadow = function shadow(hostId: string, kind: "dock" | "picker") {
  const existing = document.getElementById(hostId)
  if (existing?.shadowRoot) {
    // Re-adopt rather than reuse. A host outlives the script that made it — an
    // extension update or a reload injects new markup into the old shadow root,
    // and keeping its old sheet renders the new UI under the previous CSS.
    existing.shadowRoot.adoptedStyleSheets = [overlaySheet()]
    return { host: existing, root: existing.shadowRoot, existed: true }
  }

  const host = existing || document.createElement("div")
  host.id = hostId
  host.dataset.overlay = kind
  const root = host.attachShadow({ mode: "open" })
  root.adoptedStyleSheets = [overlaySheet()]
  if (!existing) document.documentElement.appendChild(host)
  return { host, root, existed: false }
}

// One renderer for the collapsed pill. It used to be built both by the overlay
// injector and by the session picker, and only the former grew a disconnect
// button, so it was usually absent.
globalThis.__opc_renderPill = function renderPill(
  root: ShadowRoot,
  host: HTMLElement,
  sessionLabel: string,
  queued: number,
  position?: OpcPosition | null
) {
  const h = globalThis.__opc_h!
  const makeDraggable = globalThis.__opc_makeDraggable!
  const svgIcon = globalThis.__opc_svgIcon!
  if (typeof h !== "function" || typeof makeDraggable !== "function" || typeof svgIcon !== "function") {
    throw new Error("Annotation UI helpers are unavailable")
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

  // A real button, not a span with a handler: the pill is draggable, and
  // makeDraggable only steps aside for actual controls — anything else starts a
  // drag on pointerdown and the click never lands.
  const status = h(
    "button",
    {
      attrs: {
        class: "status",
        type: "button",
        "data-role": "label",
        // Carries the full name too — it is ellipsised at 22ch, and the tooltip
        // that used to show it lived on the span this replaced.
        title: `${sessionLabel} — click to change session`,
      },
      on: { click: send("refresh_sessions") },
    },
    [h("span", { text: "Connected:" }), h("span", { text: sessionLabel, attrs: { class: "session" } })]
  )

  root.replaceChildren(
    h("div", { attrs: { class: "surface pill" } }, [
      h("div", { attrs: { class: "pill-row" } }, [
        status,
        h("span", { attrs: { class: "spacer" } }),
        h(
          "button",
          {
            attrs: { class: "btn-icon", type: "button", "aria-label": "Settings", title: "Settings" },
            on: { click: send("open_settings") },
          },
          [svgIcon(WRENCH_ICON_PATH, { viewBox: "0 0 24 24", size: 14, strokeWidth: 2.3 })]
        ),
        h(
          "button",
          {
            attrs: {
              class: "btn-icon btn-icon-danger",
              type: "button",
              "aria-label": "Disconnect tab",
              title: "Disconnect this tab",
            },
            on: { click: send("disconnect_tab") },
          },
          [svgIcon(CLOSE_ICON_PATH)]
        ),
      ]),
      h("div", { attrs: { class: "pill-row pill-row-actions" } }, [
        h("button", {
          text: "Annotate",
          attrs: { class: "btn btn-primary", type: "button", title: "Pick an element and comment on it" },
          on: { click: send("start_annotation_from_overlay") },
        }),
        h("button", {
          text: "Capture",
          attrs: { class: "btn btn-secondary", type: "button", title: "Comment on a screenshot of the whole page" },
          on: { click: send("start_capture_from_overlay") },
        }),
        h("span", { attrs: { class: "spacer" } }),
        globalThis.__opc_queueBadge!(queued),
      ]),
    ])
  )

  // Reported on drop so the position survives navigation and re-injection.
  makeDraggable(host, {
    onDrop: (dropped) => {
      try {
        chrome.runtime.sendMessage({ type: "overlay_moved", position: dropped })
      } catch {}
    },
  }).applyPosition(position)
}

/**
 * Queue depth badge. Built here and updated in place by setConnectionOverlayQueue,
 * so a new count does not cost a full pill re-render.
 */
globalThis.__opc_queueBadge = function queueBadge(queued: number) {
  const h = globalThis.__opc_h!
  const badge = h("span", { attrs: { class: "queue", "data-role": "queue" } }, [
    h("span", { attrs: { class: "queue-count", "data-role": "queue-count" } }),
    h("span", { text: "queued" }),
  ])
  globalThis.__opc_setQueueBadge!(badge, queued)
  return badge
}

globalThis.__opc_setQueueBadge = function setQueueBadge(badge: HTMLElement, queued: number) {
  const count = badge.querySelector("[data-role='queue-count']")
  if (count) count.textContent = String(queued)
  // Stays in the layout at zero; only the colour changes. Removing it resized
  // the pill on every transition through zero.
  badge.toggleAttribute("data-empty", queued < 1)
}

// Keys and focus aimed at one of our overlays, taken before the page can have
// them. Sites with keyboard shortcuts or a modal focus trap listen on document
// in the capture phase, which runs before anything inside our shadow tree: a
// preventDefault there eats the keystroke, and a focus trap re-focuses its own
// container the moment our textarea takes focus. Window capture runs ahead of
// any document listener, so stopping the event there means the page never runs
// its handler. The default action is untouched — stopPropagation does not
// cancel it, so typing still lands in the textarea.
//
// ponytail: loses to a page that captures on window itself and registered
// first (we inject after page load). An iframe-hosted composer is the only
// full fix; do that if a real site turns up that still swallows keys.
globalThis.__opc_shieldKeys = function shieldKeys(host: HTMLElement, onKeyDown?: (event: KeyboardEvent) => void) {
  const types = ["keydown", "keypress", "keyup", "beforeinput", "input", "focusin", "focusout"]

  function handle(event: Event) {
    if (!host.isConnected) return
    if (!event.composedPath().includes(host)) return
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (event.type === "keydown") onKeyDown?.(event as KeyboardEvent)
  }

  for (const type of types) window.addEventListener(type, handle, true)
  return {
    remove() {
      for (const type of types) window.removeEventListener(type, handle, true)
    },
  }
}

const DRAG_MARGIN = 8

// Every interactive control, not just buttons. A pointerdown that starts a drag
// calls preventDefault and captures the pointer, which swallows the activation
// that a checkbox or a label needs — so anything clickable has to opt out of
// dragging or it silently stops working.
const DRAG_BLOCKED_CONTROLS = "button, input, label, textarea, select, a"

/**
 * Anchors `floating` to `trigger`, flipping above when there is no room below.
 * `floating` must already be displayed — an undisplayed element measures 0 tall
 * and would always look like it fits below.
 */
globalThis.__opc_anchorTo = function anchorTo(trigger: Element, floating: HTMLElement) {
  const triggerRect = trigger.getBoundingClientRect()
  const floatingRect = floating.getBoundingClientRect()
  return anchorPosition(
    { x: triggerRect.left, y: triggerRect.top, width: triggerRect.width, height: triggerRect.height },
    { width: floatingRect.width, height: floatingRect.height },
    { width: window.innerWidth, height: window.innerHeight }
  )
}

/**
 * Free dragging: an overlay rests wherever it is dropped. It used to snap back
 * to top- or bottom-centre on release, which threw away the position you just
 * chose.
 *
 * Position is always left/top in viewport pixels, clamped so the overlay can
 * never be dragged (or resized) out of reach.
 */
globalThis.__opc_makeDraggable = function makeDraggable(overlay: HTMLElement, options = {}) {
  if (!overlay) throw new Error("overlay is required")
  // Options are captured in the closure below, so a cached API keeps whichever
  // ones it was first built with. The pill and the session picker share a host,
  // so differing options between them would resolve to "whoever rendered first"
  // — a bug that only shows up in one order. Refuse the ambiguity instead.
  if (overlay.__opcDragApi) {
    if (options.blockDragSelector && options.blockDragSelector !== overlay.__opcDragBlocked) {
      throw new Error("makeDraggable: this element already has different blockDragSelector options")
    }
    return overlay.__opcDragApi
  }

  const blockDragSelector = options.blockDragSelector || DRAG_BLOCKED_CONTROLS
  const onDrop = options.onDrop

  let dragging = false
  let pointerId: number | null = null
  let offsetX = 0
  let offsetY = 0

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  function clampToViewport(left: number, top: number): OpcPosition {
    const rect = overlay.getBoundingClientRect()
    return {
      left: clamp(left, DRAG_MARGIN, Math.max(DRAG_MARGIN, window.innerWidth - rect.width - DRAG_MARGIN)),
      top: clamp(top, DRAG_MARGIN, Math.max(DRAG_MARGIN, window.innerHeight - rect.height - DRAG_MARGIN)),
    }
  }

  // event.target is retargeted to the shadow host for anything inside the
  // shadow tree, so closest() on it would never see our controls. The composed
  // path still has the real element.
  function hitsBlockedControl(event: Event): boolean {
    return event.composedPath().some((node) => node instanceof Element && node.matches(blockDragSelector))
  }

  function getPosition(): OpcPosition {
    const rect = overlay.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }

  /** Falls back to top-centre, which is where the pill has always started. */
  function applyPosition(position?: OpcPosition | null): OpcPosition {
    const rect = overlay.getBoundingClientRect()
    const wanted = position || { left: (window.innerWidth - rect.width) / 2, top: DRAG_MARGIN }
    const next = clampToViewport(wanted.left, wanted.top)
    overlay.style.right = ""
    overlay.style.bottom = ""
    overlay.style.transform = ""
    overlay.style.left = `${Math.round(next.left)}px`
    overlay.style.top = `${Math.round(next.top)}px`
    return next
  }

  overlay.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return
    if (hitsBlockedControl(event)) return
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
    const next = clampToViewport(event.clientX - offsetX, event.clientY - offsetY)
    overlay.style.transform = ""
    overlay.style.right = ""
    overlay.style.bottom = ""
    overlay.style.left = `${Math.round(next.left)}px`
    overlay.style.top = `${Math.round(next.top)}px`
  })

  function endDrag() {
    if (!dragging) return
    dragging = false
    overlay.style.cursor = "grab"
    if (pointerId !== null) {
      try {
        overlay.releasePointerCapture(pointerId)
      } catch {}
    }
    pointerId = null
    onDrop?.(getPosition())
  }

  overlay.addEventListener("pointerup", endDrag)
  overlay.addEventListener("pointercancel", endDrag)

  // A window resize can otherwise strand an overlay outside the viewport with
  // no way to drag it back.
  window.addEventListener("resize", () => {
    if (!overlay.isConnected) return
    applyPosition(getPosition())
  })

  overlay.__opcDragBlocked = blockDragSelector
  overlay.__opcDragApi = { applyPosition, getPosition }
  return overlay.__opcDragApi
}
