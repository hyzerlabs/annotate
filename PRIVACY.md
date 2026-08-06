# Privacy Policy

**hyzer-annotate** browser extension and MCP server
Last updated: 6 August 2026

## Summary

hyzer-annotate collects nothing, transmits nothing off your machine, and has no
servers to send anything to.

## What the extension does with your data

When you annotate a page, the extension collects the comment you typed, the
page URL and title, information about the element you clicked (its CSS
selector, tag, ARIA label, visible text, and position), and — unless you clear
the **Include screenshot** checkbox — a screenshot.

All of it is sent to `http://127.0.0.1` on a port between 39280 and 39300: the
MCP server running on your own computer, which you started yourself as part of
your coding agent. That is the only network destination the extension contacts.
There is no remote endpoint, no account, no telemetry, and no analytics.

Screenshots are written to your operating system's temporary directory and
passed to your coding agent as file paths. They are deleted automatically once
they are more than six hours old.

## What is stored in your browser

Which tabs you have connected, and where you dragged the overlay. This uses
Chrome's session storage, is local to your browser, and is cleared when the
browser closes.

## What the local server stores

Pending annotations are held in memory and discarded when your agent stops,
unless you enable **Keep queue across restarts**, which writes them to a file
in your system's runtime directory so they survive a restart. Either way the
data stays on your computer. Set `HYZER_ANNOTATE_DIR` to control where that
directory is.

## Third parties

None. No data is sold, shared, or transferred to anyone, for any purpose.

## Permissions

The extension asks for access to a website only at the moment you connect a tab
to an agent session, one origin at a time. It cannot read any page until you do
that.

## Changes

Material changes will be published here and reflected in the extension's Chrome
Web Store listing.

## Contact

Questions and issues: https://github.com/hyzerlabs/annotate/issues

The full source for both the extension and the server is available at
https://github.com/hyzerlabs/annotate under GPL-3.0, so every claim above can
be verified directly.
