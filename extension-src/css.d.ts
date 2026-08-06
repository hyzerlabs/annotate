// CSS is bundled as a string by scripts/build-extension.mjs (loader ".css":
// "text") and adopted into a shadow root at runtime, never added to the
// annotated page's stylesheets.
//
// Must stay free of imports and exports: a wildcard module declaration is only
// ambient in a non-module file. Putting this in globals.d.ts made TypeScript
// read it as a module augmentation instead.
declare module "*.css" {
  const css: string
  export default css
}
