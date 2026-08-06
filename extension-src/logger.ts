export function logExtension(message: string, details?: unknown) {
  if (details === undefined) {
    console.log(`[hyzer-annotate] ${message}`)
    return
  }
  console.log(`[hyzer-annotate] ${message}`, details)
}

export function warnExtension(message: string, details?: unknown) {
  if (details === undefined) {
    console.warn(`[hyzer-annotate] ${message}`)
    return
  }
  console.warn(`[hyzer-annotate] ${message}`, details)
}

export function errorExtension(message: string, details?: unknown) {
  if (details === undefined) {
    console.error(`[hyzer-annotate] ${message}`)
    return
  }
  console.error(`[hyzer-annotate] ${message}`, details)
}
