import type { SessionInfo, SessionPickerContext } from "./types.js"

function sessionPickerScript(items: SessionInfo[], context: SessionPickerContext) {
  const h = globalThis.__opc_h!
  const shadow = globalThis.__opc_shadow!
  const makeDraggable = globalThis.__opc_makeDraggable!
  const renderPill = globalThis.__opc_renderPill!
  if (
    typeof h !== "function" ||
    typeof shadow !== "function" ||
    typeof makeDraggable !== "function" ||
    typeof renderPill !== "function"
  ) {
    throw new Error("Annotation UI helpers are unavailable")
  }

  if (typeof globalThis.__opc_cleanupSessionPicker === "function") {
    globalThis.__opc_cleanupSessionPicker()
  }

  function closeIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 12 12")
    svg.setAttribute("width", "11")
    svg.setAttribute("height", "11")
    svg.setAttribute("aria-hidden", "true")

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", "M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5")
    path.setAttribute("stroke", "currentColor")
    path.setAttribute("stroke-width", "1.6")
    path.setAttribute("stroke-linecap", "round")
    svg.appendChild(path)
    return svg
  }

  function sessionButton(item: SessionInfo, onSelect: () => void) {
    return h(
      "button",
      {
        attrs: { class: "item", type: "button", "data-role": "session-item" },
        on: {
          click: () => {
            try {
              chrome.runtime.sendMessage({ type: "connect_tab_to_session", session: item })
            } catch {}
            onSelect()
          },
        },
      },
      [
        h("div", { text: item.title || item.id, attrs: { class: "item-name" } }),
        h("div", { text: item.directory || item.id, attrs: { class: "item-meta" } }),
      ]
    )
  }

  function emptyStateContent() {
    if (context.reason === "no-sessions") {
      return {
        text: "The annotation server responded but did not report an active session for this project.",
        steps: [
          "Start your coding agent in the project you want to edit",
          "Check that hyzer-annotate is configured as an MCP server there",
          "Restart the agent if you just changed its config",
        ],
      }
    }

    return {
      text: "No local annotation server was found on ports 39280-39300.",
      steps: [
        "Add hyzer-annotate to your agent's MCP config",
        "Start your coding agent in the project you want to edit",
        "Restart the agent if you just changed its config",
      ],
    }
  }

  function renderEmptyState() {
    const content = emptyStateContent()
    return h("div", { attrs: { class: "empty" } }, [
      h("p", { text: content.text }),
      h("ol", {}, content.steps.map((step) => h("li", { text: step }))),
      h("div", { attrs: { class: "actions" } }, [
        h("button", {
          text: "Try again",
          attrs: { class: "btn btn-primary", type: "button" },
          on: {
            click: () => {
              try {
                chrome.runtime.sendMessage({ type: "refresh_sessions" })
              } catch {}
            },
          },
        }),
      ]),
    ])
  }

  const { host, root, existed } = shadow("__opc_connection_overlay", "dock")
  // Read the pill's state before it is replaced, so closing restores it.
  const priorSession = root.querySelector(".session")?.textContent || "agent session"
  const priorQueued = Number(root.querySelector("[data-role='queue-count']")?.textContent) || 0
  const priorPersist = (root.querySelector("[data-role='persist-input']") as HTMLInputElement | null)?.checked === true
  const drag = makeDraggable(host, {
    blockDragSelector: "button",
    onDrop: (dropped) => {
      try {
        chrome.runtime.sendMessage({ type: "overlay_moved", position: dropped })
      } catch {}
    },
  })
  // Expanding makes the overlay taller; keep the position it already had, and
  // let applyPosition clamp it back into view if it now overflows.
  const priorPosition = existed ? drag.getPosition() : null

  const close = () => {
    cleanupKeyboard()
    if (!existed) {
      host.remove()
      return
    }
    renderPill(root, host, priorSession, priorQueued, priorPersist, priorPosition)
  }

  const heading = items.length ? "Connect this tab to a local agent session" : "No agent session available"

  root.replaceChildren(
    h("div", { attrs: { class: "surface panel" } }, [
      h("div", { attrs: { class: "header" } }, [
        h("div", { text: heading, attrs: { class: "heading" } }),
        h(
          "button",
          {
            attrs: { class: "btn-icon", type: "button", "aria-label": "Close session picker" },
            on: { click: close },
          },
          [closeIcon()]
        ),
      ]),
      items.length
        ? h("div", { attrs: { class: "list" } }, items.map((item) => sessionButton(item, close)))
        : renderEmptyState(),
    ])
  )

  drag.applyPosition(priorPosition)

  const sessionButtons = Array.from(root.querySelectorAll("[data-role='session-item']")) as HTMLElement[]
  let focusedIndex = sessionButtons.length ? 0 : -1

  function setFocusedIndex(nextIndex: number) {
    if (!sessionButtons.length) {
      focusedIndex = -1
      return
    }

    const count = sessionButtons.length
    focusedIndex = ((nextIndex % count) + count) % count
    sessionButtons.forEach((button, index) => {
      button.toggleAttribute("data-focused", index === focusedIndex)
    })
    sessionButtons[focusedIndex].focus({ preventScroll: true })
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!host.isConnected) return
    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }

    if (!sessionButtons.length) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setFocusedIndex(focusedIndex + 1)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setFocusedIndex(focusedIndex - 1)
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      if (focusedIndex >= 0) sessionButtons[focusedIndex].click()
    }
  }

  function cleanupKeyboard() {
    document.removeEventListener("keydown", onKeyDown, true)
    if (globalThis.__opc_cleanupSessionPicker === cleanupKeyboard) {
      delete globalThis.__opc_cleanupSessionPicker
    }
  }

  document.addEventListener("keydown", onKeyDown, true)
  globalThis.__opc_cleanupSessionPicker = cleanupKeyboard
  setFocusedIndex(0)
}

export async function showSessionPicker(
  tabId: number,
  sessions: SessionInfo[],
  context: SessionPickerContext = { instanceCount: sessions.length ? 1 : 0 }
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["injected/dom.js"],
  })
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [sessions.slice(0, 12), context],
    func: sessionPickerScript,
  })
}
