// Screenshot capture. Two modes: crop to the element the user picked, or
// stitch the whole scrollable page from viewport captures.
//
// Everything here runs in the service worker, which has OffscreenCanvas and
// createImageBitmap but no FileReader and no Image — hence the manual
// base64 <-> Blob helpers.

import { CAPTURE_ELEMENT_PADDING_PX, CAPTURE_MAX_BANDS, CAPTURE_MIN_INTERVAL_MS } from "./constants.js"
import { captureScale, cropBox, planBands, stitchHeight } from "./geometry.js"
import { logExtension } from "./logger.js"
import type { AnnotationElement, AnnotationScreenshot, AnnotationViewport } from "./types.js"

type PageMetrics = {
  scrollWidth: number
  scrollHeight: number
  innerWidth: number
  innerHeight: number
  scrollX: number
  scrollY: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",")
  if (commaIndex < 0) throw new Error("Malformed screenshot data URL")
  const mime = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png"
  const binary = atob(dataUrl.slice(commaIndex + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // Chunked because String.fromCharCode(...bytes) blows the stack on real images.
  const CHUNK = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

let lastCaptureAt = 0

// captureVisibleTab is quota'd at 2 calls/sec. The spacing doubles as the
// settle delay after a scroll, so there's no separate sleep for that.
async function captureViewport(windowId: number): Promise<string> {
  const wait = CAPTURE_MIN_INTERVAL_MS - (Date.now() - lastCaptureAt)
  if (wait > 0) await sleep(wait)
  try {
    const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" })
    lastCaptureAt = Date.now()
    return shot
  } catch (error) {
    // Quota is the only failure worth retrying; anything else throws again below.
    await sleep(CAPTURE_MIN_INTERVAL_MS)
    const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" })
    lastCaptureAt = Date.now()
    return shot
  }
}

async function canvasToDataUrl(canvas: OffscreenCanvas): Promise<string> {
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }))
}

function readPageMetrics(): PageMetrics {
  const doc = document.documentElement
  return {
    scrollWidth: Math.max(doc.scrollWidth, document.body?.scrollWidth || 0),
    scrollHeight: Math.max(doc.scrollHeight, document.body?.scrollHeight || 0),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }
}

// Returns the scroll position actually reached — the page may refuse to scroll
// as far as we asked, and the stitch draws at the real offset, not the intended one.
function scrollToBand(top: number, hideFixed: boolean): Promise<number> {
  const HIDDEN_ATTR = "data-opc-prior-visibility"
  if (hideFixed) {
    for (const node of Array.from(document.body?.querySelectorAll("*") || [])) {
      const element = node as HTMLElement
      if (element.id === "__opc_connection_overlay") continue
      if (element.hasAttribute(HIDDEN_ATTR)) continue
      const position = getComputedStyle(element).position
      if (position !== "fixed" && position !== "sticky") continue
      element.setAttribute(HIDDEN_ATTR, element.style.visibility || "")
      element.style.visibility = "hidden"
    }
  }
  window.scrollTo({ top, left: 0, behavior: "instant" as ScrollBehavior })
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY)))
  })
}

function restorePage(scrollX: number, scrollY: number): void {
  const HIDDEN_ATTR = "data-opc-prior-visibility"
  for (const node of Array.from(document.querySelectorAll(`[${HIDDEN_ATTR}]`))) {
    const element = node as HTMLElement
    element.style.visibility = element.getAttribute(HIDDEN_ATTR) || ""
    element.removeAttribute(HIDDEN_ATTR)
  }
  window.scrollTo({ top: scrollY, left: scrollX, behavior: "instant" as ScrollBehavior })
}

async function runInTab<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  args: Args
): Promise<Result> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    args,
    func: func as (...injectedArgs: unknown[]) => Result,
  })
  return injection?.result as Result
}

export async function captureElement(
  tab: chrome.tabs.Tab,
  element: AnnotationElement,
  viewport: AnnotationViewport
): Promise<AnnotationScreenshot> {
  const shot = await captureViewport(tab.windowId!)
  const bitmap = await createImageBitmap(dataUrlToBlob(shot))

  try {
    const scale = captureScale(bitmap.width, viewport.width)
    const box = cropBox(element.rect, bitmap, scale, CAPTURE_ELEMENT_PADDING_PX)

    // Element scrolled out of view or collapsed to nothing — the untouched
    // viewport shot is more useful to the agent than a 0x0 crop.
    if (box.width < 1 || box.height < 1) {
      logExtension("Element crop empty, sending full viewport", { tabId: tab.id, selector: element.selector })
      return { mime: "image/png", dataUrl: shot, mode: "element", cropped: false }
    }

    const canvas = new OffscreenCanvas(box.width, box.height)
    canvas
      .getContext("2d")!
      .drawImage(bitmap, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height)
    logExtension("Cropped screenshot to element", { tabId: tab.id, ...box, scale })
    return { mime: "image/png", dataUrl: await canvasToDataUrl(canvas), mode: "element", cropped: true }
  } finally {
    bitmap.close()
  }
}

export async function captureFullPage(tab: chrome.tabs.Tab): Promise<AnnotationScreenshot> {
  const metrics = await runInTab(tab.id!, readPageMetrics, [])
  const { bands, totalBands, truncated } = planBands(metrics.scrollHeight, metrics.innerHeight, CAPTURE_MAX_BANDS)

  if (bands === 1) {
    return { mime: "image/png", dataUrl: await captureViewport(tab.windowId!), mode: "page", truncated }
  }

  let canvas: OffscreenCanvas | null = null
  let context: OffscreenCanvasRenderingContext2D | null = null
  let scale = 1

  try {
    for (let band = 0; band < bands; band++) {
      // Fixed and sticky chrome is hidden from the second band on, so a sticky
      // header isn't stamped into every stitched strip. The first band keeps it
      // so the page still looks like itself.
      // ponytail: hiding sticky elements can leave a gap where a sticky sidebar
      // was. Per-element intersection math if that ever actually bites.
      const reachedY = await runInTab(tab.id!, scrollToBand, [band * metrics.innerHeight, band === 1])
      const bitmap = await createImageBitmap(dataUrlToBlob(await captureViewport(tab.windowId!)))

      if (!canvas) {
        scale = captureScale(bitmap.width, metrics.innerWidth)
        canvas = new OffscreenCanvas(
          bitmap.width,
          stitchHeight(metrics.scrollHeight, metrics.innerHeight, bands, scale)
        )
        context = canvas.getContext("2d")
      }

      context!.drawImage(bitmap, 0, Math.round(reachedY * scale))
      bitmap.close()
    }
  } finally {
    await runInTab(tab.id!, restorePage, [metrics.scrollX, metrics.scrollY]).catch(() => {})
  }

  if (truncated) {
    logExtension("Full-page capture truncated", { tabId: tab.id, captured: bands, total: totalBands })
  }
  return { mime: "image/png", dataUrl: await canvasToDataUrl(canvas!), mode: "page", truncated }
}
