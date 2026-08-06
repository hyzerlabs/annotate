export type SessionInfo = {
  id: string
  title?: string
  directory?: string
  status?: string
  baseUrl: string
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
}

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
  screenshot: AnnotationScreenshot
}

export type ExtensionMessage =
  | { type: "start_annotation_from_overlay" }
  | { type: "start_capture_from_overlay" }
  | { type: "connect_tab_to_session"; session: SessionInfo }
  | { type: "disconnect_tab" }
  | { type: "refresh_sessions" }

export type InstanceStatus = {
  app?: string
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
