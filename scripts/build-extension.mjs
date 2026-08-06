import { copyFileSync, mkdirSync, readdirSync, rmSync, unlinkSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { build } from "esbuild"

const root = resolve(process.cwd())
const sourceDir = join(root, "extension-src")
const outputDir = join(root, "extension")
const iconSvg = join(root, "icon.svg")

mkdirSync(outputDir, { recursive: true })
for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".js")) unlinkSync(join(outputDir, entry.name))
}
rmSync(join(outputDir, "injected"), { recursive: true, force: true })
mkdirSync(join(outputDir, "injected"), { recursive: true })
mkdirSync(join(outputDir, "icons"), { recursive: true })

copyFileSync(join(sourceDir, "manifest.json"), join(outputDir, "manifest.json"))

// sips is macOS-only; skip icon generation elsewhere rather than fail the build.
if (process.platform === "darwin") {
  for (const size of [16, 48, 128]) {
    const icon = spawnSync(
      "sips",
      ["-s", "format", "png", "-z", String(size), String(size), iconSvg, "--out", join(outputDir, "icons", `icon${size}.png`)],
      { cwd: root, stdio: "inherit" }
    )
    if (icon.status !== 0) process.exit(icon.status ?? 1)
  }
} else if (!existsSync(join(outputDir, "icons", "icon16.png"))) {
  console.warn("Skipping icon generation (needs macOS sips). Extension icons will be missing.")
}

await build({
  entryPoints: [join(sourceDir, "background.ts"), join(sourceDir, "injected", "dom.ts")],
  outdir: outputDir,
  outbase: sourceDir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  // CSS is inlined as a string and adopted into a shadow root at runtime, so
  // it never reaches the annotated page's stylesheets.
  loader: { ".css": "text" },
})
