declare global {
  type OpcElementOptions = {
    text?: string
    style?: string
    attrs?: Record<string, string>
    on?: Record<string, EventListener>
  }

  type OpcPosition = { left: number; top: number }

  type OpcDragApi = {
    applyPosition(position?: OpcPosition | null): OpcPosition
    getPosition(): OpcPosition
  }

  var __opc_h: ((tag: string, options?: OpcElementOptions, children?: Node[]) => HTMLElement) | undefined
  var __opc_makeDraggable:
    | ((
        overlay: HTMLElement,
        options?: { blockDragSelector?: string; onDrop?: (position: OpcPosition) => void }
      ) => OpcDragApi)
    | undefined
  type OpcShadow = { host: HTMLElement; root: ShadowRoot; existed: boolean }

  var __opc_shadow: ((hostId: string, kind: "dock" | "picker") => OpcShadow) | undefined
  var __opc_renderPill:
    | ((
        root: ShadowRoot,
        host: HTMLElement,
        sessionLabel: string,
        queued: number,
        position?: OpcPosition | null
      ) => void)
    | undefined
  type OpcIconOptions = { viewBox?: string; size?: number; strokeWidth?: number }

  var __opc_svgIcon: ((d: string, options?: OpcIconOptions) => SVGSVGElement) | undefined
  var __opc_anchorTo:
    | ((trigger: Element, floating: HTMLElement) => OpcPosition & { side: "top" | "bottom" })
    | undefined
  var __opc_queueBadge: ((queued: number) => HTMLElement) | undefined
  var __opc_setQueueBadge: ((badge: HTMLElement, queued: number) => void) | undefined
  var __opc_shieldKeys:
    | ((host: HTMLElement, onKeyDown?: (event: KeyboardEvent) => void) => { remove(): void })
    | undefined
  /** Tears down whichever panel is currently expanded over the pill. */
  var __opc_cleanupPanel: (() => void) | undefined
  /** Same, for the settings popup, which floats beside the pill instead. */
  var __opc_cleanupSettings: (() => void) | undefined

  interface HTMLElement {
    __opcDragApi?: OpcDragApi
    __opcDragBlocked?: string
  }
}

export {}
