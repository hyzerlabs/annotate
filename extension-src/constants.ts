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

// chrome.storage.local: a browser-side preference, not part of any agent session.
export const OUTLINE_COLOR_KEY = "outlineColor"

// chrome.storage.session: the comment from a send that failed, held for the next
// composer so a server that was down does not cost the user their typing.
// Session rather than local — it should not outlive the browser.
export const DRAFT_COMMENT_KEY = "draftComment"
