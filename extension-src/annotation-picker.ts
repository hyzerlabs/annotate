import { logExtension, warnExtension } from "./logger.js"
import type { AnnotationElement, AnnotationMode, AnnotationPickerResult, AnnotationViewport } from "./types.js"

function annotationPickerScript(mode: AnnotationMode): Promise<AnnotationPickerResult> {
  const h = globalThis.__opc_h!
  const shadow = globalThis.__opc_shadow!
  const makeDraggable = globalThis.__opc_makeDraggable!
  const anchorTo = globalThis.__opc_anchorTo!
  if (
    typeof h !== "function" ||
    typeof shadow !== "function" ||
    typeof makeDraggable !== "function" ||
    typeof anchorTo !== "function"
  ) {
    throw new Error("Annotation UI helpers are unavailable")
  }

  // Open against the pill that triggered this, so the composer appears where
  // the user was already looking. Flips fully above the pill when there is no
  // room below. Falls back to top-centre if the pill is gone.
  function composerAnchor(panel: HTMLElement): OpcPosition | null {
    const pill = document.getElementById("__opc_connection_overlay")
    if (!pill) return null
    return anchorTo(pill, panel)
  }

  const ROLE_BY_TAG = {
    A: "link",
    BUTTON: "button",
    INPUT: "textbox",
    SELECT: "combobox",
    TEXTAREA: "textbox",
  }

  function cssEscape(value: string): string {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value)
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
  }

  function inferRole(el: HTMLElement): string {
    return el.getAttribute("role") || ROLE_BY_TAG[el.tagName as keyof typeof ROLE_BY_TAG] || ""
  }

  function buildSelector(el: HTMLElement | null): string {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return ""
    if (el.id) return `#${cssEscape(el.id)}`

    const parts: string[] = []
    let current: HTMLElement | null = el
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = current.tagName.toLowerCase()
      if (current.classList && current.classList.length) {
        part += "." + Array.from(current.classList).slice(0, 2).map(cssEscape).join(".")
      }
      const parent = current.parentElement
      if (parent) {
        const currentTag = current.tagName
        const siblings = Array.from(parent.children).filter((child: Element) => child.tagName === currentTag)
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`
        }
      }
      parts.unshift(part)
      if (current.parentElement?.id) {
        parts.unshift(`#${cssEscape(current.parentElement.id)}`)
        break
      }
      current = current.parentElement
    }
    return parts.join(" > ")
  }

  function describeElement(el: HTMLElement): AnnotationElement {
    const rect = el.getBoundingClientRect()
    return {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      role: inferRole(el),
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 500),
      ariaLabel: el.getAttribute("aria-label"),
      id: el.id || null,
      className: typeof el.className === "string" ? el.className : "",
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    }
  }

  function describeViewport(): AnnotationViewport {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    }
  }

  function createUI() {
    document.getElementById("__opc_annotation_root")?.remove()
    const { host, root } = shadow("__opc_annotation_root", "picker")

    const box = h("div", { attrs: { class: "highlight" } })
    box.style.display = "none"

    const targetInfo = h("div", {
      attrs: { class: "target", title: "Click to expand" },
      on: { click: () => targetInfo.classList.toggle("expanded") },
    })
    const textarea = h("textarea") as HTMLTextAreaElement
    textarea.placeholder =
      mode === "page" ? "What should the agent know about this page?" : "What should the agent know?"

    const cancelButton = h("button", {
      text: "Cancel",
      attrs: { class: "btn btn-soft-danger", type: "button" },
    }) as HTMLButtonElement
    const submitButton = h("button", {
      text: "Send",
      attrs: { class: "btn btn-primary", type: "button" },
    }) as HTMLButtonElement

    const screenshotToggle = h("input", { attrs: { type: "checkbox" } }) as HTMLInputElement
    screenshotToggle.checked = true

    const toggleLabel = h("label", { attrs: { class: "toggle" } }, [
      screenshotToggle,
      h("span", { text: mode === "page" ? "Include page screenshot" : "Include screenshot" }),
    ])

    const panel = h("div", { attrs: { class: "surface panel composer" } }, [
      h("div", {
        text: mode === "page" ? "Comment on this page" : "Annotate selection",
        attrs: { class: "heading" },
      }),
      targetInfo,
      textarea,
      h("div", { attrs: { class: "actions" } }, [toggleLabel, cancelButton, submitButton]),
    ])

    root.replaceChildren(box, panel)

    // The default blocked-controls list covers the textarea and buttons, so text
    // selection in the comment box works and the controls stay clickable. The
    // selector chip has to join them: a drag captures the pointer, and a captured
    // pointer sends the click to the panel instead of the chip.
    const drag = makeDraggable(panel, {
      blockDragSelector: "button, input, label, textarea, select, a, .target",
    })

    return { host, root, box, panel, targetInfo, textarea, cancelButton, submitButton, screenshotToggle, drag }
  }

  function updateHighlight(box: HTMLElement, el: HTMLElement | null): void {
    if (!el) {
      box.style.display = "none"
      return
    }
    const rect = el.getBoundingClientRect()
    box.style.display = "block"
    box.style.top = `${rect.top}px`
    box.style.left = `${rect.left}px`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
  }

  return new Promise((resolve) => {
    const ui = createUI()

    const state: { selected: HTMLElement | null; locked: boolean; finished: boolean } = {
      selected: null,
      locked: false,
      finished: false,
    }

    function removeListeners() {
      document.removeEventListener("mousemove", onMouseMove, true)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }

    function finish(resultPayload: AnnotationPickerResult) {
      if (state.finished) return
      state.finished = true
      removeListeners()
      ui.host.remove()
      resolve(resultPayload)
    }

    function finishWithSendAnimation(resultPayload: AnnotationPickerResult) {
      if (state.finished) return
      state.finished = true
      removeListeners()
      ui.submitButton.disabled = true
      ui.cancelButton.disabled = true
      ui.textarea.disabled = true
      ui.submitButton.textContent = "Sending"
      // Fades in place rather than sliding off to the right. The composer is
      // anchored to the pill now, so a slide to the screen edge came from
      // nowhere and went nowhere; a dissolve hands off to the toast that
      // replaces it.
      requestAnimationFrame(() => {
        ui.panel.style.transform = "translateY(-4px)"
        ui.panel.style.opacity = "0"
        ui.box.style.opacity = "0"
      })
      // Outlasts the CSS transition, so the panel is gone rather than snapping
      // away half-faded.
      setTimeout(() => {
        ui.host.remove()
        resolve(resultPayload)
      }, 280)
    }

    // Position after display: an undisplayed panel measures zero, which would
    // make every anchor decision look like it fits below.
    function showComposer() {
      ui.panel.style.display = "block"
      ui.drag.applyPosition(composerAnchor(ui.panel))
      ui.textarea.focus()
    }

    function submitAnnotation() {
      if (mode === "element" && !state.selected) {
        finish({ cancelled: true })
        return
      }
      finishWithSendAnimation({
        cancelled: false,
        comment: ui.textarea.value.trim(),
        element: state.selected ? describeElement(state.selected) : null,
        viewport: describeViewport(),
        includeScreenshot: ui.screenshotToggle.checked,
      })
    }

    // elementFromPoint retargets anything inside our shadow tree to the host,
    // so the host is the only thing we ever need to reject.
    function elementUnderPointer(event: MouseEvent): HTMLElement | null {
      const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
      if (!el || el === ui.host || ui.host.contains(el)) return null
      return el
    }

    function onMouseMove(event: MouseEvent) {
      if (state.locked) return
      const el = elementUnderPointer(event)
      if (!el) return
      state.selected = el
      updateHighlight(ui.box, el)
    }

    function onClick(event: MouseEvent) {
      // event.target is retargeted to the host too, so the composed path is the
      // only way to tell a click on the composer from a click on the page.
      if (event.composedPath().includes(ui.panel)) return
      if (state.locked) return
      const el = elementUnderPointer(event)
      if (!el) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      state.locked = true
      state.selected = el
      updateHighlight(ui.box, el)
      ui.targetInfo.textContent = `${el.tagName.toLowerCase()} ${buildSelector(el)}`.trim()
      showComposer()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        finish({ cancelled: true })
        return
      }
      if (state.locked && event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        submitAnnotation()
      }
    }

    ui.cancelButton.addEventListener("click", () => finish({ cancelled: true }))
    ui.submitButton.addEventListener("click", submitAnnotation)

    // Page mode has nothing to point at, so skip straight to the comment box.
    if (mode === "page") {
      state.locked = true
      ui.targetInfo.textContent = "Whole page"
      showComposer()
    } else {
      document.addEventListener("mousemove", onMouseMove, true)
      document.addEventListener("click", onClick, true)
    }
    document.addEventListener("keydown", onKeyDown, true)
  })
}

export async function runAnnotationPicker(tabId: number, mode: AnnotationMode): Promise<AnnotationPickerResult | null> {
  logExtension("Starting annotation picker", { tabId, mode })
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["injected/dom.js"],
  })
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [mode],
    func: annotationPickerScript,
  })

  const picked = result[0]?.result || null
  if (!picked) {
    warnExtension("Annotation picker returned no result", { tabId })
    return null
  }

  if (picked.cancelled === true) {
    logExtension("Annotation picker cancelled", { tabId })
  } else {
    logExtension("Annotation picker selected element", {
      tabId,
      selector: picked.element?.selector,
      tag: picked.element?.tag,
      commentLength: typeof picked.comment === "string" ? picked.comment.length : 0,
    })
  }

  return picked
}
