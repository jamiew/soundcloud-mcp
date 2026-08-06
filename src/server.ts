// MCP server identity, shared by both entrypoints. The two differ only in how
// they authenticate, so that is the one line each supplies for itself.

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
		"- When the user pastes a soundcloud.com link, start with `resolve_url` — it returns the underlying track, user, or playlist.",
		"- Ids may be numeric or URNs (`soundcloud:tracks:123`). Both work; URNs are what SoundCloud prefers.",
		"- List results carry `next_href`. Pass it to `next_page` to page (default 50 per page, max 200).",
		authLine,
		"- There is no personalized recommendation endpoint. Seed `get_related_tracks` from something the user already likes, or read `get_feed`.",
	].join("\n");
}
