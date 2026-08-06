/**
 * @hyzer-labs/ui declares its tokens on :root, which matches nothing inside a
 * shadow root. Moving them to :host is what lets the overlays use the real
 * design tokens without putting a single rule on the annotated page.
 *
 * Two selectors need rewriting and the attribute form differs: :host takes its
 * condition as an argument, so `:root:not([x])` becomes `:host(:not([x]))`
 * rather than `:host:not([x])`.
 *
 * Deliberately left alone:
 *   [data-theme='dark']  — already unscoped; the token docs say it themes any
 *                          subtree, so it works as-is inside the shadow root.
 *   body { --hz-space-* } — the density ladder. There is no <body> in a shadow
 *                          root, so it is inert; overlay.css declares the rung
 *                          directly, which the token docs call the intended
 *                          escape hatch.
 *
 * Kept in its own module so test/token-scope.mjs can run it over the real
 * installed stylesheet and fail if an upgrade introduces a new :root selector.
 */
export function scopeTokensToHost(css: string): string {
  return css.replace(/:root:not\(\[data-theme\]\)/g, ":host(:not([data-theme]))").replace(/:root\b/g, ":host")
}

/** Strips comments so callers can assert on selectors without prose matches. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}
