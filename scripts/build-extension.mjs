import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { build } from "esbuild"

const ICON_SIZES = [16, 48, 128]

const root = resolve(process.cwd())
const sourceDir = join(root, "extension-src")
const outputDir = join(root, "extension")
const iconDir = join(root, "icons")

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

mkdirSync(outputDir, { recursive: true })
for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".js")) unlinkSync(join(outputDir, entry.name))
}
rmSync(join(outputDir, "injected"), { recursive: true, force: true })
mkdirSync(join(outputDir, "injected"), { recursive: true })
mkdirSync(join(outputDir, "icons"), { recursive: true })

// One version, from package.json. The Chrome Web Store rejects re-uploading a
// version it already has, and a hand-maintained second copy in the manifest is
// exactly the sort of thing that gets forgotten on the release that matters.
const manifest = JSON.parse(readFileSync(join(sourceDir, "manifest.json"), "utf8"))
manifest.version = pkg.version
writeFileSync(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

// Icons are committed rather than generated here — see scripts/generate-icons.mjs.
const missing = ICON_SIZES.filter((size) => !existsSync(join(iconDir, `icon${size}.png`)))
if (missing.length) {
  console.error(`Missing icons: ${missing.map((s) => `icons/icon${s}.png`).join(", ")}. Run "npm run icons" on macOS.`)
  process.exit(1)
}
for (const size of ICON_SIZES) {
  copyFileSync(join(iconDir, `icon${size}.png`), join(outputDir, "icons", `icon${size}.png`))
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

console.log(`extension: built ${manifest.name} v${manifest.version}`)
