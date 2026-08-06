// Capture arithmetic. Runs on Node's native TS stripping — no build step.
import assert from "node:assert/strict"
import { captureScale, cropBox, planBands, stitchHeight } from "../extension-src/geometry.ts"

const VIEWPORT = { width: 1280, height: 800 }
const RETINA = { width: 2560, height: 1600 }

// scale is measured, not assumed — this is what makes browser zoom work
assert.equal(captureScale(2560, 1280), 2)
assert.equal(captureScale(1408, 1280), 1.1, "110% zoom on a 1x display")
assert.equal(captureScale(2560, 0), 1, "degenerate viewport falls back to 1x")

// a mid-page element, 2x display, 12px of padding
const box = cropBox({ x: 100, y: 200, width: 300, height: 50 }, RETINA, 2, 12)
assert.deepEqual(box, { left: 176, top: 376, width: 648, height: 148 })
assert.equal(box.width, (300 + 24) * 2, "padding applied on both sides")

// padding must not push the crop outside the capture
const corner = cropBox({ x: 0, y: 0, width: 40, height: 40 }, RETINA, 2, 12)
assert.deepEqual(corner, { left: 0, top: 0, width: 104, height: 104 })

// an element wider than the viewport clamps to the capture, not past it
const wide = cropBox({ x: 0, y: 0, width: 5000, height: 5000 }, RETINA, 2, 12)
assert.equal(wide.left + wide.width, RETINA.width)
assert.equal(wide.top + wide.height, RETINA.height)

// scrolled out of view above and below both collapse, which is the signal
// captureElement uses to fall back to the untouched viewport shot
assert.equal(cropBox({ x: 0, y: -500, width: 100, height: 100 }, RETINA, 2, 12).height, 0)
assert.equal(cropBox({ x: 0, y: 2000, width: 100, height: 100 }, RETINA, 2, 12).height, 0)
assert.equal(cropBox({ x: -900, y: 0, width: 100, height: 100 }, RETINA, 2, 12).width, 0)

// band planning
assert.deepEqual(planBands(800, 800, 12), { bands: 1, totalBands: 1, truncated: false })
assert.deepEqual(planBands(801, 800, 12), { bands: 2, totalBands: 2, truncated: false }, "one pixel over needs a second band")
assert.deepEqual(planBands(4000, 800, 12), { bands: 5, totalBands: 5, truncated: false })
assert.deepEqual(planBands(40000, 800, 12), { bands: 12, totalBands: 50, truncated: true }, "cap reports truncation")
assert.deepEqual(planBands(4000, 0, 12), { bands: 1, totalBands: 1, truncated: false }, "no viewport height, no stitch")

// stitch canvas is the real page height when it fits, the capped height when it doesn't
assert.equal(stitchHeight(4000, 800, 5, 2), 8000, "exact fit")
assert.equal(stitchHeight(3900, 800, 5, 2), 7800, "short final band does not overrun the canvas")
assert.equal(stitchHeight(40000, 800, 12, 2), 19200, "truncated stitch is bands * viewport")

// the last band is drawn at the scroll position actually reached, which for a
// short final band overlaps the previous one and must still land inside
const scale = 2
const lastBandTop = Math.round((3900 - 800) * scale)
assert.ok(lastBandTop + 800 * scale <= stitchHeight(3900, 800, 5, scale), "final band fits the canvas exactly")

console.log("geometry: ok")
