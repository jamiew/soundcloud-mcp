// One waveform mark, served as SVG and PNG. Used as the MCP server icon, the
// install page's favicon, and `/icon.svg` / `/icon.png` / `/favicon.ico`.

export const ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f50"/><g fill="#fff"><rect x="12" y="25" width="5" height="14" rx="2.5"/><rect x="21" y="19" width="5" height="26" rx="2.5"/><rect x="30" y="14" width="5" height="36" rx="2.5"/><rect x="39" y="21" width="5" height="22" rx="2.5"/><rect x="48" y="26" width="5" height="12" rx="2.5"/></g></svg>';

// 128x128 render of the same mark, inlined so the worker needs no asset binding.
// Regenerate with `rsvg-convert -w 128 -h 128 icon.svg`.
const ICON_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAABSlBMVEUAAAD/QAD/UwD/VAD/VgD/VQD/VQD/VQD/VQD/VQD/VQD/VQD/VQD/VQD/VQD/VQD/VgD/VQD/VQD/VQD/VgD/WQD/VQD/VAD/VQD/VgD/XQD/VQD/VQD/VAD/YAD/VAD/VQD/TQD/UgD/VQD/VQD/WAD/VwD/VQD/VQD/VQD/UwD/VQD/VQD/VwD/VQD/VQD/VQD/WAD/VQD/SQD/VQD/VAD/VgD/UQD/VQD/VAD/VQD/VQD/VAD/VQD/VgD/VQD/VQD/VwD/UwD/VgD/VQD/VQD/VQD/VQD/VQD/VgD/VQD/VAD/VQD/VAD/ZgD/VgD/VAD/VQD/VAD/VgD/VQD/UgD/UwD/VQD/VQD/VQD/VwD/VQD/VQD/VQD/ik//1cD/+PT/1L//iE3/sIj/////roX/iEz/1L7/9/P/9vL/9vH/073/h0v/rIO/KTX+AAAAXXRSTlMABDdzm8Le7vr5BlGu8vGtUBWE7IMUDIj0hgvi4U8IkaIKHNDOGiPc4Cco6ukmG9/jHc0HmZRNE/OFgetSTqrvAzg0cZzDwO34mHJwM6kFgIJLl5LLGSLbCRI13b82qvQ9AAAC8ElEQVR42u2b7VcSQRTGr4AgvgeWWFqRopIWJRtWpJKWVKaiZW82voVKaP//11RaBWZhd5iZez2deb6x58DzO2dnn2d3mQvgoDafP9AeDHUwRQqHgu0Bv68NPKmzq7uHaVFvX3+nq/2NSJRpVHTgZlP7W4MxplmxoduN/fvvMAQNjzSwv3uPIel+3Mn/wShD01iC9x+fYIiaTNb7P5xiqJp+VOv/OMWQ9eRpzfobZeiaSVcBWIxAz678uxiJMrZ/PEUDMGxn4iAjUqTiP/ucCiBWaaYXjEwvL/o/SgeQPb8/eMUINXcG0E0JMH92/9dLCbCQg9eMVIvgpwVYgje0ABa8pQVYhhQtQBDytABZCNMCvAO57+/s7u3tH8j8ghzAr+KFDqkAdor/dEQEsGsDHBMBlGyA30QAxUsZAAOABFCfe9gAXO4hA/C5hwzA5x4yAJ97TgCi/Qgya94BQLgfFQOI96NiAPF+VAwg3o+KAcSvCwMAMsmvF8BD8msF8JL83gCaZyPIJL+KbASZ5FeRjaB2zYtno3YAt2zUDuB2XRgAA2AADIABMAD/P8BlHZeJAPbtAyet3pKV5QAO7AOnggA8eYtn/LDy+Y/oTSlP3uqSOzoulU5OxR9MOHL0R7N6cvN0bABU5J52ALfc0w7glnv6X1S65J6aV7Xl1nNPCsBLO2h9We2lHfT+YeGhHfQCeGgHzQDu14UBMADIAOLdpxhAvPsUA4h3n2IA8e5TDSDcfQ4A5BuZyLdykW9mI9/OF6AFeA8faAFWwEcL8JF+Wy/0UQKs0k03VJQh3tw+tXa+vX6ADmD9egw4wBAVQOG6DLnACA3AxtWg0SaF/6fqUa8xfP/P1aNekEBfBsGt2nG75DSuf/24H8CXr5j+qSQ/cpmYQTz/W05Dp2m0oVcr3WDuNjOJsvw2Gg8exyPae6Gn8K3p7PVsIau1f9e/uw+/z80v6HEPrWbWvA3g534sWcvbeWVPbeH89k9rZTHn5PUXoz+AfC4ryhsAAAAASUVORK5CYII=";

export const ICON_PNG = Uint8Array.from(atob(ICON_PNG_BASE64), (c) => c.charCodeAt(0));

// The MCP icons spec requires clients to support https URLs and lets them
// reject data URIs, so the worker advertises a real URL. It is hardcoded
// because server metadata is built before any request tells us our origin;
// self-deployers should change it.
export const HOSTED_ICON = {
	src: "https://soundcloud-mcp.jamie-7e9.workers.dev/icon.png",
	mimeType: "image/png",
	sizes: ["128x128"],
};

// stdio has no origin at all, so it inlines the mark.
export const INLINE_ICON = {
	src: `data:image/svg+xml;utf8,${encodeURIComponent(ICON_SVG)}`,
	mimeType: "image/svg+xml",
	sizes: ["any"],
};
