export const APP_ID = "hyzer-annotate"
export const PORT_START = 39280
export const PORT_END = 39300

export const DISCOVERY_TIMEOUT_MS = 200
export const CONNECTION_CHECK_INTERVAL_MS = 10000
export const CONNECTION_STATUS_TIMEOUT_MS = 1200

// chrome.tabs.captureVisibleTab is quota'd at 2 calls/sec.
export const CAPTURE_MIN_INTERVAL_MS = 550
export const CAPTURE_ELEMENT_PADDING_PX = 12
// A tall page at ~0.55s per band gets slow fast; 12 bands is ~7s.
export const CAPTURE_MAX_BANDS = 12
