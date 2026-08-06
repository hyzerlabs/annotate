// Rasterizes icon.svg into the tracked icons/ directory.
//
// Run by hand (`npm run icons`) when icon.svg changes, NOT as part of the
// build: sips is macOS-only, so a build that depended on it would silently
// ship an iconless extension on Linux and in CI. The PNGs are committed
// instead, which is why this is a regenerate step rather than a build step.
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const ICON_SIZES = [16, 48, 128]

const root = resolve(process.cwd())
const iconSvg = join(root, "icon.svg")
const iconDir = join(root, "icons")

if (process.platform !== "darwin") {
  console.error("npm run icons needs macOS (sips). Regenerate there and commit the PNGs.")
  process.exit(1)
}

mkdirSync(iconDir, { recursive: true })

for (const size of ICON_SIZES) {
  const out = join(iconDir, `icon${size}.png`)
  const result = spawnSync("sips", ["-s", "format", "png", "-z", String(size), String(size), iconSvg, "--out", out], {
    cwd: root,
    stdio: "inherit",
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`icons: wrote ${ICON_SIZES.map((s) => `icon${s}.png`).join(", ")} — commit them`)
