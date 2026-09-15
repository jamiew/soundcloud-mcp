// Shared identity; each transport supplies its own auth instructions.

import { INLINE_ICON } from "./icon.js";

export function serverInfo(name: string, version: string, icons = [INLINE_ICON]) {
	return {
		name,
		version,
		title: "SoundCloud",
		description:
			"Search SoundCloud, read your library, and manage playlists, follows, likes and reposts.",
		websiteUrl: "https://github.com/jamiew/soundcloud-mcp",
		icons,
	};
}

/** `authLine` describes how this transport gets credentials. */
export function instructions(authLine: string): string {
	return [
		"SoundCloud, through the official API.",
		"",
		"- Resolve pasted SoundCloud links with `resolve_url`.",
		"- Prefer URNs (`soundcloud:tracks:123`); numeric ids also work.",
		"- Pass `next_href` to `next_page`. Page size: 50 by default, 200 max.",
		authLine,
		"- For recommendations, use `get_related_tracks` with a liked track or read `get_feed`.",
	].join("\n");
}
