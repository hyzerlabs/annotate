import type { SettingsState } from "./types.js"

function settingsPanelScript(state: SettingsState) {
  const h = globalThis.__opc_h!
  const shadow = globalThis.__opc_shadow!
  const makeDraggable = globalThis.__opc_makeDraggable!
  const anchorTo = globalThis.__opc_anchorTo!
  const svgIcon = globalThis.__opc_svgIcon!
  const shieldKeys = globalThis.__opc_shieldKeys!
  if (
    typeof h !== "function" ||
    typeof shadow !== "function" ||
    typeof makeDraggable !== "function" ||
    typeof anchorTo !== "function" ||
    typeof svgIcon !== "function" ||
    typeof shieldKeys !== "function"
  ) {
    throw new Error("Annotation UI helpers are unavailable")
  }

  // Its own host, next to the pill rather than instead of it — so the pill keeps
  // working while settings are open, and closing is a removal rather than a
  // rebuild of whatever was underneath.
  globalThis.__opc_cleanupSettings?.()
  document.getElementById("__opc_settings_root")?.remove()
  // "dock", not "picker": a picker host covers the viewport, and this one has to
  // be its own footprint so annotating the popup highlights and crops the popup
  // rather than the whole screen.
  const { host, root } = shadow("__opc_settings_root", "dock")

  const close = () => {
    cleanup()
    host.remove()
  }

  const persistInput = h("input", { attrs: { type: "checkbox" } }) as HTMLInputElement
  persistInput.checked = state.persistQueue
  // The box flips itself on click, before the server has agreed. Nothing else
  // would put it back on failure, so it would sit there claiming a setting that
  // never took.
  persistInput.addEventListener("change", () => {
    const wanted = persistInput.checked
    const revert = () => {
      if (persistInput.isConnected) persistInput.checked = !wanted
    }
    try {
      chrome.runtime
        .sendMessage({ type: "set_persist_queue", persistQueue: wanted })
        .then((response) => {
          if (!response?.ok) revert()
        })
        .catch(revert)
    } catch {
      revert()
    }
  })

  const persistRow = h("label", {
    attrs: {
      class: "toggle setting-row setting-row-inline",
      title: "Queued annotations survive an agent restart, written under the runtime directory",
    },
  }, [persistInput, h("span", { text: "Keep queue across restarts" })])

  // #2563eb is the light-theme primary, shown as the swatch when nothing has
  // been picked. Sending null puts the highlight back on the token, which is the
  // only setting that follows light and dark on its own.
  const colorInput = h("input", { attrs: { type: "color", "aria-label": "Annotation outline colour" } }) as HTMLInputElement
  colorInput.value = state.outlineColor || "#2563eb"
  colorInput.addEventListener("change", () => setOutlineColor(colorInput.value))

  function setOutlineColor(color: string | null) {
    try {
      chrome.runtime.sendMessage({ type: "set_outline_color", color })
    } catch {}
  }

  // Swatch first, then its label — the same shape as the checkbox row above, so
  // the two controls line up down the left edge.
  const colorRow = h("div", { attrs: { class: "setting-row" } }, [
    h("span", { attrs: { class: "setting-controls" } }, [
      colorInput,
      h("span", { text: "Annotation outline" }),
    ]),
    h("button", {
      text: "Default",
      attrs: { class: "btn btn-quiet", type: "button", title: "Follow the light/dark theme" },
      on: {
        click: () => {
          colorInput.value = "#2563eb"
          setOutlineColor(null)
        },
      },
    }),
  ])

  // Chrome owns extension shortcuts: they are declared in the manifest and
  // rebound only on its own page, so this reports the bindings and hands over.
  const shortcutHeader = h("div", { attrs: { class: "setting-row" } }, [
    h("span", { text: "Keyboard shortcuts" }),
    h("button", {
      text: "Change shortcuts",
      attrs: { class: "btn btn-quiet", type: "button" },
      on: {
        click: () => {
          try {
            chrome.runtime.sendMessage({ type: "open_shortcuts" })
          } catch {}
          close()
        },
      },
    }),
  ])

  const shortcutRows = state.shortcuts.map((shortcut) =>
    h("div", { attrs: { class: "setting-row setting-row-inline" } }, [
      h("span", {
        text: shortcut.shortcut || "Not set",
        attrs: { class: shortcut.shortcut ? "kbd" : "kbd kbd-unset" },
      }),
      h("span", { text: shortcut.label }),
    ])
  )

  const panel = h("div", { attrs: { class: "surface panel settings" } }, [
      h("div", { attrs: { class: "header" } }, [
        h("div", { text: "Settings", attrs: { class: "heading" } }),
        h(
          "button",
          {
            attrs: { class: "btn-icon btn-icon-danger", type: "button", "aria-label": "Close settings" },
            on: { click: close },
          },
          [svgIcon("M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5")]
        ),
      ]),
      persistRow,
      colorRow,
      shortcutHeader,
      ...shortcutRows,
    h("div", { attrs: { class: "settings-footer" } }, [
      h("a", {
        text: "hyzerlabs/annotate on GitHub",
        attrs: { href: "https://github.com/hyzerlabs/annotate", target: "_blank", rel: "noreferrer noopener" },
      }),
    ]),
  ])

  root.replaceChildren(panel)

  // Anchored after mounting: an unmeasured host looks zero-tall, which would
  // make every anchor decision look like it fits below the pill.
  const pill = document.getElementById("__opc_connection_overlay")
  makeDraggable(host).applyPosition(pill ? anchorTo(pill, host) : null)

  function onKeyDown(event: KeyboardEvent) {
    if (!host.isConnected) return
    if (event.key !== "Escape") return
    event.preventDefault()
    close()
  }

  function cleanup() {
    document.removeEventListener("keydown", onKeyDown, true)
    shield.remove()
    if (globalThis.__opc_cleanupSettings === cleanup) delete globalThis.__opc_cleanupSettings
  }

  const shield = shieldKeys(host, onKeyDown)
  document.addEventListener("keydown", onKeyDown, true)
  globalThis.__opc_cleanupSettings = cleanup
}

export async function showSettingsPanel(tabId: number, state: SettingsState): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["injected/dom.js"],
  })
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args: [state],
    func: settingsPanelScript,
  })
}
