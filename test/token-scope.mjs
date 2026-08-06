// Runs the :root -> :host rewrite over the REAL @hyzer-labs/ui stylesheet, so
// an upgrade that introduces a new :root selector fails here rather than
// silently shipping unstyled overlays.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { scopeTokensToHost, stripCssComments } from "../extension-src/token-scope.ts"

const require = createRequire(import.meta.url)
const tokensPath = require.resolve("@hyzer-labs/ui/tokens.css")
const tokens = readFileSync(tokensPath, "utf8")

// the rewrite is only meaningful if the upstream sheet still uses :root
assert.match(stripCssComments(tokens), /:root/, "upstream tokens.css no longer uses :root — revisit token-scope.ts")

const scoped = stripCssComments(scopeTokensToHost(tokens))

assert.doesNotMatch(scoped, /:root/, "every :root selector must become :host")
assert.match(scoped, /:host\s*\{/, "the base token block is scoped to the shadow host")
assert.match(
  scoped,
  /:host\(:not\(\[data-theme\]\)\)/,
  "the system-preference block needs :host(:not(...)), not :host:not(...)"
)
assert.doesNotMatch(scoped, /:host:not\(/, ":host takes its condition as an argument")

// constructed stylesheets drop @import silently, so tokens.css must not use it
assert.doesNotMatch(scoped, /@import/, "tokens.css must be self-contained for replaceSync")

// left alone on purpose — see token-scope.ts
assert.match(scoped, /\[data-theme='dark'\]\s*\{/, "the dark theme block stays unscoped so it can theme a subtree")

// the rewrite must not damage the custom properties themselves
assert.match(scoped, /--hz-color-surface:/)
assert.match(scoped, /--hz-intent-primary:/)
assert.equal(
  (tokens.match(/--hz-/g) || []).length,
  (scopeTokensToHost(tokens).match(/--hz-/g) || []).length,
  "no token declarations lost in the rewrite"
)

console.log("token-scope: ok")
