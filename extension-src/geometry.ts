// Pure capture arithmetic, kept out of capture.ts so it can be tested without
// OffscreenCanvas or a browser. See test/geometry.mjs.

export type Rect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
export type CropBox = { left: number; top: number; width: number; height: number }
export type BandPlan = { bands: number; totalBands: number; truncated: boolean }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Scale is measured from the capture rather than assumed from devicePixelRatio:
 * browser zoom and per-monitor scaling both make dpr a lie.
 */
export function captureScale(bitmapWidth: number, cssWidth: number): number {
  if (!cssWidth || !Number.isFinite(cssWidth)) return 1
  return bitmapWidth / cssWidth
}

/**
 * Element rect (CSS px, viewport-relative) to a crop box in capture pixels,
 * padded for context and clamped to the capture. A box with zero width or
 * height means the element wasn't visible in the capture.
 */
export function cropBox(rect: Rect, bitmap: Size, scale: number, pad: number): CropBox {
  const left = clamp(Math.round((rect.x - pad) * scale), 0, bitmap.width)
  const top = clamp(Math.round((rect.y - pad) * scale), 0, bitmap.height)
  const right = clamp(Math.round((rect.x + rect.width + pad) * scale), 0, bitmap.width)
  const bottom = clamp(Math.round((rect.y + rect.height + pad) * scale), 0, bitmap.height)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** How many viewport-height bands a full-page capture needs, capped. */
export function planBands(scrollHeight: number, innerHeight: number, maxBands: number): BandPlan {
  if (!innerHeight || !Number.isFinite(innerHeight)) {
    return { bands: 1, totalBands: 1, truncated: false }
  }
  const totalBands = Math.max(1, Math.ceil(scrollHeight / innerHeight))
  const bands = Math.min(totalBands, maxBands)
  return { bands, totalBands, truncated: bands < totalBands }
}

export type AnchorSide = "top" | "bottom"
export type AnchorResult = { left: number; top: number; side: AnchorSide }

/**
 * Places a floating panel against a trigger, preferring below and flipping to
 * fully above when below lacks room — never overlapping the trigger, which is
 * what clamping a below-position into the viewport would do.
 *
 * Aligned to the trigger's left edge, then shifted along that axis to stay
 * inside `padding`. Same fit/flip/shift shape as @hyzer-labs/ui's `place()`,
 * which is not reachable: ./positioning is absent from the package exports.
 */
export function anchorPosition(
  trigger: Rect,
  floating: Size,
  viewport: Size,
  offset = 8,
  padding = 8
): AnchorResult {
  const roomBelow = viewport.height - (trigger.y + trigger.height) - offset - padding
  const roomAbove = trigger.y - offset - padding

  // Below unless it does not fit and above is genuinely roomier — so a panel
  // too tall for either side still lands on the side with more space.
  const below = roomBelow >= floating.height || roomBelow >= roomAbove
  const top = below ? trigger.y + trigger.height + offset : trigger.y - offset - floating.height

  const maxLeft = Math.max(padding, viewport.width - floating.width - padding)
  const left = Math.min(Math.max(trigger.x, padding), maxLeft)

  return { left, top, side: below ? "bottom" : "top" }
}

/** Canvas height for a stitch of `bands` bands, in capture pixels. */
export function stitchHeight(scrollHeight: number, innerHeight: number, bands: number, scale: number): number {
  return Math.round(Math.min(scrollHeight, bands * innerHeight) * scale)
}
