import { DEBUG } from "./config.js";

// IMPORTANT: a stdio MCP server uses stdout for JSON-RPC framing. Anything
// written to stdout corrupts the protocol stream, so all logging goes to stderr.
export function logError(...args: unknown[]): void {
	console.error(...args);
}

export function debug(...args: unknown[]): void {
	if (DEBUG) console.error("[debug]", ...args);
}
