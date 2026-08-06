export type SessionInfo = {
  id: string
  title?: string
  directory?: string
  status?: string
  baseUrl: string
  /** Queue depth reported by discovery, so a new claim seeds its badge correctly. */
  queued?: number
  /** Same, for the persistence toggle — an unseeded claim forces a needless re-render. */
  persistQueue?: boolean
}

export type SessionPickerReason = "plugin-not-found" | "no-sessions"

export type SessionPickerContext = {
  reason?: SessionPickerReason
  instanceCount: number
}

export type SessionQueryResult = {
  sessions: SessionInfo[]
  context: SessionPickerContext
}

export type TabClaim = {
  sessionId: string
  sessionLabel?: string
  baseUrl: string
  origin?: string | null
  extensionVersion?: string
  /** Last known queue depth on this tab's server, for the pill counter. */
  queued?: number
  /** Where the user dragged the pill, so it stays put across navigation. */
  position?: OverlayPosition | null
  /** Server-side setting, mirrored here so the pill renders it without a fetch. */
  persistQueue?: boolean
}

export type OverlayPosition = { left: number; top: number }

export type AnnotationElement = {
  selector: string
  tag: string
  role: string
  text: string
  ariaLabel: string | null
  id: string | null
  className: string
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

export type AnnotationViewport = {
  width: number
  height: number
  devicePixelRatio: number
}

// "element": user picked a node, screenshot is cropped to it.
// "page": no node, screenshot is the whole scrollable page.
export type AnnotationMode = "element" | "page"

export type AnnotationPickerResult =
  | { cancelled: true }
  | {
      cancelled: false
      comment: string
      element: AnnotationElement | null
      viewport: AnnotationViewport
      /** Composer checkbox. When off, no capture runs and no image is sent. */
      includeScreenshot: boolean
    }

export type AnnotationScreenshot = {
  mime: "image/png"
  dataUrl: string
  mode: AnnotationMode
  /** element mode: false when the element was offscreen and the full viewport was sent instead */
  cropped?: boolean
  /** page mode: true when the page was taller than the band cap */
  truncated?: boolean
}

export type AnnotationPayload = {
  comment: string
  mode: AnnotationMode
  page: {
    url: string
    title: string
  }
  element: AnnotationElement | null
  viewport: AnnotationViewport
  screenshot: AnnotationScreenshot | null
}

export type ExtensionMessage =
  | { type: "start_annotation_from_overlay" }
  | { type: "start_capture_from_overlay" }
  | { type: "connect_tab_to_session"; session: SessionInfo }
  | { type: "disconnect_tab" }
  | { type: "refresh_sessions" }
  | { type: "overlay_moved"; position: OverlayPosition }
  | { type: "set_persist_queue"; persistQueue: boolean }

export type InstanceStatus = {
  app?: string
  queued?: number
  persistQueue?: boolean
  [key: string]: unknown
}

export type DiscoveredInstance = {
  baseUrl: string
  status: InstanceStatus
}

export type JsonResult<T = unknown> = {
  ok: boolean
  status: number
  payload: T | null
}

export type ClaimsStore = {
  restore(): Promise<void>
  get(tabId: number | undefined): TabClaim | undefined
  set(tabId: number, claim: TabClaim): void
  delete(tabId: number | undefined): boolean
  entries(): IterableIterator<[number, TabClaim]>
  values(): IterableIterator<TabClaim>
  size(): number
}
