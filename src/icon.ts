// One waveform mark, used three ways: the MCP server icon, the install page's
// favicon, and `/icon.svg`.

export const ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f50"/><g fill="#fff"><rect x="12" y="25" width="5" height="14" rx="2.5"/><rect x="21" y="19" width="5" height="26" rx="2.5"/><rect x="30" y="14" width="5" height="36" rx="2.5"/><rect x="39" y="21" width="5" height="22" rx="2.5"/><rect x="48" y="26" width="5" height="12" rx="2.5"/></g></svg>';

// Inlined rather than pointing at this worker's own `/icon.svg`: the MCP server
// metadata is built before we know the request origin, and a client that can
// reach the server can always render a data URI.
export const ICON_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(ICON_SVG)}`;
