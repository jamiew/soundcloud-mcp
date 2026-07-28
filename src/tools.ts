import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	RateLimitedError,
	SoundCloudApiError,
	SoundCloudAuthError,
	type SoundCloudClient,
} from "./client.js";
import type { SoundCloudPlaylist, SoundCloudTrack, TrackStreams } from "./types.js";

type ContentBlock =
	| { type: "text"; text: string }
	| { type: "resource_link"; uri: string; name: string; mimeType?: string; description?: string };

type ToolResult = {
	content: ContentBlock[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

// Tool annotations per the MCP spec. openWorldHint is true everywhere since
// every tool talks to the external SoundCloud API.
const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
} as const;

// Declared output schemas so clients can validate and render `structuredContent`
// instead of re-parsing the text block. Only the envelope is described: SoundCloud
// adds and drops fields without notice, and pinning them buys nothing.
//
// `looseObject`, not `object`, is load-bearing. A plain object compiles to
// `additionalProperties: false`, and the *client* validates strictly — so an extra
// field SoundCloud tacks on (`query_urn` on the feed) becomes a protocol error the
// server never sees. Omitted entirely on `next_page`, which doubles as an escape
// hatch for endpoints returning a bare array rather than a collection.
const PAGE_OUT = z.looseObject({
	collection: z.array(z.unknown()).describe("The items on this page"),
	next_href: z.string().nullish().describe("Absolute URL of the next page — pass to next_page"),
});
const LIST_OUT = z.looseObject({ items: z.array(z.unknown()) });

/** Accepts either a numeric id or a `soundcloud:…` URN. */
const id = z.union([z.string(), z.number()]);
const limit = z.number().int().min(1).max(200).default(50);

function ok(data: unknown, extra: ContentBlock[] = []): ToolResult {
	const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
	const result: ToolResult = { content: [{ type: "text", text }, ...extra] };
	if (data && typeof data === "object") {
		result.structuredContent = Array.isArray(data)
			? { items: data }
			: (data as Record<string, unknown>);
	}
	return result;
}

function toolError(message: string): ToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

// Raw SoundCloud error bodies never reach the model; every failure becomes a
// short, actionable sentence.
function mapError(error: unknown): ToolResult {
	if (error instanceof SoundCloudAuthError || error instanceof RateLimitedError) {
		return toolError(error.message);
	}
	if (error instanceof SoundCloudApiError) {
		if (error.status === 404) {
			return toolError("SoundCloud could not find that resource — check the id or URN.");
		}
		if (error.status === 403) {
			return toolError(
				"SoundCloud refused this action. The track or playlist may be private, or the creator disabled it."
			);
		}
		if (error.status === 405) {
			return toolError("SoundCloud no longer offers this endpoint to third-party apps.");
		}
		return toolError(error.message);
	}
	return toolError(error instanceof Error ? error.message : String(error));
}

/** Runs a handler, turning results into MCP content and errors into clean text. */
async function run<T>(
	fn: () => Promise<T>,
	extra?: (data: T) => ContentBlock[]
): Promise<ToolResult> {
	try {
		const data = await fn();
		return ok(data, extra?.(data) ?? []);
	} catch (error) {
		return mapError(error);
	}
}

function trackLinks(track?: SoundCloudTrack): ContentBlock[] {
	if (!track) return [];
	const links: ContentBlock[] = [];
	if (track.permalink_url) {
		links.push({
			type: "resource_link",
			uri: track.permalink_url,
			name: track.title ?? "track",
			mimeType: "text/html",
			...(track.user?.username ? { description: `by ${track.user.username}` } : {}),
		});
	}
	if (track.artwork_url) {
		links.push({
			type: "resource_link",
			uri: track.artwork_url,
			name: `${track.title ?? "track"} — artwork`,
			mimeType: "image/jpeg",
		});
	}
	return links;
}

function playlistLinks(playlist?: SoundCloudPlaylist): ContentBlock[] {
	if (!playlist?.permalink_url) return [];
	return [
		{
			type: "resource_link",
			uri: playlist.permalink_url,
			name: playlist.title ?? "playlist",
			mimeType: "text/html",
		},
	];
}

// Prefer the progressive MP3, fall back to preview or HLS. Time-limited by SoundCloud.
function streamLinks(streams?: TrackStreams): ContentBlock[] {
	const uri = streams?.http_mp3_128_url ?? streams?.preview_mp3_128_url ?? streams?.hls_mp3_128_url;
	if (!uri) return [];
	return [{ type: "resource_link", uri, name: "audio stream", mimeType: "audio/mpeg" }];
}

export function registerTools(server: McpServer, sc: SoundCloudClient): void {
	// --- Discovery ---
	server.registerTool(
		"search_tracks",
		{
			title: "Search tracks",
			description: "Search SoundCloud tracks by keyword, with optional genre/tag/BPM filters.",
			inputSchema: {
				query: z.string().min(1),
				limit,
				genres: z.array(z.string()).optional().describe("e.g. ['Electronic','House']"),
				tags: z.array(z.string()).optional(),
				bpmFrom: z.number().optional(),
				bpmTo: z.number().optional(),
				durationFrom: z.number().optional().describe("Milliseconds"),
				durationTo: z.number().optional().describe("Milliseconds"),
				access: z.array(z.enum(["playable", "preview", "blocked"])).optional(),
			},
			outputSchema: PAGE_OUT,
			annotations: { title: "Search tracks", ...READ },
		},
		async ({ query, limit: max, genres, tags, bpmFrom, bpmTo, durationFrom, durationTo, access }) =>
			run(() =>
				sc.searchTracks({
					q: query,
					limit: max,
					...(genres?.length ? { genres: genres.join(",") } : {}),
					...(tags?.length ? { tags: tags.join(",") } : {}),
					...(bpmFrom !== undefined ? { "bpm[from]": bpmFrom } : {}),
					...(bpmTo !== undefined ? { "bpm[to]": bpmTo } : {}),
					...(durationFrom !== undefined ? { "duration[from]": durationFrom } : {}),
					...(durationTo !== undefined ? { "duration[to]": durationTo } : {}),
					...(access?.length ? { access: access.join(",") } : {}),
				})
			)
	);

	server.registerTool(
		"search_playlists",
		{
			title: "Search playlists",
			description: "Search SoundCloud playlists by keyword.",
			inputSchema: { query: z.string().min(1), limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Search playlists", ...READ },
		},
		async ({ query, limit: max }) => run(() => sc.searchPlaylists(query, max))
	);

	server.registerTool(
		"search_users",
		{
			title: "Search users",
			description: "Search SoundCloud users/artists by keyword.",
			inputSchema: { query: z.string().min(1), limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Search users", ...READ },
		},
		async ({ query, limit: max }) => run(() => sc.searchUsers(query, max))
	);

	server.registerTool(
		"resolve_url",
		{
			title: "Resolve a SoundCloud URL",
			description:
				"Turn any soundcloud.com or on.soundcloud.com permalink into the underlying track, user, or playlist. Use this whenever the user pastes a SoundCloud link.",
			inputSchema: { url: z.string().url() },
			annotations: { title: "Resolve a SoundCloud URL", ...READ },
		},
		async ({ url }) => run(() => sc.resolve(url))
	);

	server.registerTool(
		"get_track",
		{
			title: "Get track",
			description: "Get details for one track.",
			inputSchema: { trackId: id },
			annotations: { title: "Get track", ...READ },
		},
		async ({ trackId }) => run(() => sc.getTrack(trackId), trackLinks)
	);

	server.registerTool(
		"get_user",
		{
			title: "Get user",
			description: "Get a user's public profile.",
			inputSchema: { userId: id },
			annotations: { title: "Get user", ...READ },
		},
		async ({ userId }) => run(() => sc.getUser(userId))
	);

	server.registerTool(
		"get_user_tracks",
		{
			title: "Get an artist's tracks",
			description:
				"List the tracks a user has uploaded, newest first. Use search_users first to find the user id.",
			inputSchema: { userId: id, limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get an artist's tracks", ...READ },
		},
		async ({ userId, limit: max }) => run(() => sc.getUserTracks(userId, max))
	);

	server.registerTool(
		"get_user_playlists",
		{
			title: "Get an artist's playlists",
			description: "List the playlists a user has published.",
			inputSchema: { userId: id, limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get an artist's playlists", ...READ },
		},
		async ({ userId, limit: max }) => run(() => sc.getUserPlaylists(userId, max))
	);

	server.registerTool(
		"get_user_likes",
		{
			title: "Get an artist's likes",
			description: "List tracks a user has liked — often a better taste signal than their uploads.",
			inputSchema: { userId: id, limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get an artist's likes", ...READ },
		},
		async ({ userId, limit: max }) => run(() => sc.getUserLikes(userId, max))
	);

	server.registerTool(
		"get_playlist",
		{
			title: "Get playlist",
			description: "Get a playlist's details and its tracks.",
			inputSchema: { playlistId: id },
			annotations: { title: "Get playlist", ...READ },
		},
		async ({ playlistId }) => run(() => sc.getPlaylist(playlistId), playlistLinks)
	);

	server.registerTool(
		"get_playlist_tracks",
		{
			title: "Get playlist tracks",
			description: "Page through a playlist's tracks without refetching the whole playlist.",
			inputSchema: { playlistId: id, limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get playlist tracks", ...READ },
		},
		async ({ playlistId, limit: max }) => run(() => sc.getPlaylistTracks(playlistId, max))
	);

	server.registerTool(
		"get_related_tracks",
		{
			title: "Get related tracks",
			description:
				"SoundCloud's track-to-track recommendations. This is the main recommendation surface — seed it with a track the user likes.",
			inputSchema: { trackId: id, limit },
			outputSchema: LIST_OUT,
			annotations: { title: "Get related tracks", ...READ },
		},
		async ({ trackId, limit: max }) => run(() => sc.getRelatedTracks(trackId, max))
	);

	server.registerTool(
		"get_related_artists",
		{
			title: "Get related artists",
			description: "SoundCloud's artist-to-artist recommendations for a user.",
			inputSchema: { userId: id, limit },
			outputSchema: LIST_OUT,
			annotations: { title: "Get related artists", ...READ },
		},
		async ({ userId, limit: max }) => run(() => sc.getRelatedArtists(userId, max))
	);

	server.registerTool(
		"get_stream_url",
		{
			title: "Get stream URL",
			description:
				"Get playable audio URLs for a track. These are time-limited, and blocked tracks return nothing.",
			inputSchema: { trackId: id },
			annotations: { title: "Get stream URL", ...READ },
		},
		async ({ trackId }) => run(() => sc.getTrackStreams(trackId), streamLinks)
	);

	server.registerTool(
		"get_comments",
		{
			title: "Get track comments",
			description: "Get comments on a track, with their timestamps into the audio.",
			inputSchema: { trackId: id, limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get track comments", ...READ },
		},
		async ({ trackId, limit: max }) => run(() => sc.getComments(trackId, max))
	);

	server.registerTool(
		"next_page",
		{
			title: "Next page",
			description:
				"Follow the `next_href` cursor from any paginated result to fetch the next page.",
			inputSchema: { nextHref: z.string().url().describe("The next_href from a previous result") },
			annotations: { title: "Next page", ...READ },
		},
		async ({ nextHref }) => run(() => sc.nextPage(nextHref))
	);

	// --- My library ---
	server.registerTool(
		"get_profile",
		{
			title: "Get my profile",
			description: "Get the connected user's SoundCloud profile.",
			annotations: { title: "Get my profile", ...READ },
		},
		async () => run(() => sc.getMe())
	);

	server.registerTool(
		"get_my_likes",
		{
			title: "Get my likes",
			description: "List tracks the connected user has liked.",
			inputSchema: { limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get my likes", ...READ },
		},
		async ({ limit: max }) => run(() => sc.getMyLikes(max))
	);

	server.registerTool(
		"get_my_playlists",
		{
			title: "Get my playlists",
			description: "List the connected user's playlists.",
			inputSchema: { limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get my playlists", ...READ },
		},
		async ({ limit: max }) => run(() => sc.getMyPlaylists(max))
	);

	server.registerTool(
		"get_my_tracks",
		{
			title: "Get my uploads",
			description: "List tracks the connected user has uploaded.",
			inputSchema: { limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get my uploads", ...READ },
		},
		async ({ limit: max }) => run(() => sc.getMyTracks(max))
	);

	server.registerTool(
		"get_my_followings",
		{
			title: "Get who I follow",
			description: "List the users the connected user follows.",
			inputSchema: { limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get who I follow", ...READ },
		},
		async ({ limit: max }) => run(() => sc.getMyFollowings(max))
	);

	server.registerTool(
		"get_feed",
		{
			title: "Get my feed",
			description:
				"Recent tracks from people the user follows — the personalized discovery surface.",
			inputSchema: { limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get my feed", ...READ },
		},
		async ({ limit: max }) => run(() => sc.getFeed(max))
	);

	server.registerTool(
		"get_recently_played",
		{
			title: "Get recently played",
			description: "Tracks the connected user played recently, most recent first.",
			inputSchema: { limit },
			outputSchema: PAGE_OUT,
			annotations: { title: "Get recently played", ...READ },
		},
		async ({ limit: max }) => run(() => sc.getRecentlyPlayed(max))
	);

	// --- Social writes ---
	server.registerTool(
		"like_track",
		{
			title: "Like track",
			description: "Like a track.",
			inputSchema: { trackId: id },
			annotations: { title: "Like track", ...WRITE, idempotentHint: true },
		},
		async ({ trackId }) =>
			run(async () => {
				await sc.likeTrack(trackId);
				return `Liked track ${trackId}.`;
			})
	);

	server.registerTool(
		"unlike_track",
		{
			title: "Unlike track",
			description: "Remove a like from a track.",
			inputSchema: { trackId: id },
			annotations: { title: "Unlike track", ...WRITE, idempotentHint: true },
		},
		async ({ trackId }) =>
			run(async () => {
				await sc.unlikeTrack(trackId);
				return `Unliked track ${trackId}.`;
			})
	);

	server.registerTool(
		"repost_track",
		{
			title: "Repost track",
			description: "Repost a track to the user's followers.",
			inputSchema: { trackId: id },
			annotations: { title: "Repost track", ...WRITE, idempotentHint: true },
		},
		async ({ trackId }) =>
			run(async () => {
				await sc.repostTrack(trackId);
				return `Reposted track ${trackId}.`;
			})
	);

	server.registerTool(
		"unrepost_track",
		{
			title: "Remove repost",
			description: "Remove a repost of a track.",
			inputSchema: { trackId: id },
			annotations: { title: "Remove repost", ...WRITE, idempotentHint: true },
		},
		async ({ trackId }) =>
			run(async () => {
				await sc.unrepostTrack(trackId);
				return `Removed repost of track ${trackId}.`;
			})
	);

	server.registerTool(
		"follow_user",
		{
			title: "Follow user",
			description: "Follow a user.",
			inputSchema: { userId: id },
			annotations: { title: "Follow user", ...WRITE, idempotentHint: true },
		},
		async ({ userId }) =>
			run(async () => {
				await sc.followUser(userId);
				return `Followed user ${userId}.`;
			})
	);

	server.registerTool(
		"unfollow_user",
		{
			title: "Unfollow user",
			description: "Unfollow a user.",
			inputSchema: { userId: id },
			annotations: { title: "Unfollow user", ...WRITE, idempotentHint: true },
		},
		async ({ userId }) =>
			run(async () => {
				await sc.unfollowUser(userId);
				return `Unfollowed user ${userId}.`;
			})
	);

	server.registerTool(
		"add_comment",
		{
			title: "Add comment",
			description:
				"Comment on a track, optionally anchored to a moment in the audio. Fails if the creator disabled comments.",
			inputSchema: {
				trackId: id,
				body: z.string().min(1),
				timestamp: z.number().int().min(0).optional().describe("Milliseconds into the track"),
			},
			annotations: { title: "Add comment", ...WRITE },
		},
		async ({ trackId, body, timestamp }) => run(() => sc.addComment(trackId, body, timestamp))
	);

	// --- Playlist writes ---
	server.registerTool(
		"create_playlist",
		{
			title: "Create playlist",
			description:
				"Create a playlist, optionally seeded with tracks. Private unless told otherwise.",
			inputSchema: {
				title: z.string().min(1),
				description: z.string().optional(),
				sharing: z.enum(["public", "private"]).default("private"),
				trackIds: z.array(id).optional(),
			},
			annotations: { title: "Create playlist", ...WRITE },
		},
		async ({ title, description, sharing, trackIds }) =>
			run(
				() =>
					sc.createPlaylist({
						title,
						sharing,
						...(description !== undefined ? { description } : {}),
						...(trackIds ? { trackIds } : {}),
					}),
				playlistLinks
			)
	);

	server.registerTool(
		"update_playlist",
		{
			title: "Update playlist",
			description:
				"Rename a playlist, change its description or sharing, or replace its whole tracklist (also how you reorder).",
			inputSchema: {
				playlistId: id,
				title: z.string().optional(),
				description: z.string().optional(),
				sharing: z.enum(["public", "private"]).optional(),
				trackIds: z.array(id).optional().describe("Replaces the tracklist entirely, in this order"),
			},
			annotations: { title: "Update playlist", ...DESTRUCTIVE },
		},
		async ({ playlistId, ...updates }) =>
			run(() => sc.updatePlaylist(playlistId, updates), playlistLinks)
	);

	server.registerTool(
		"add_tracks_to_playlist",
		{
			title: "Add tracks to playlist",
			description: "Append tracks to an existing playlist.",
			inputSchema: { playlistId: id, trackIds: z.array(id).min(1) },
			annotations: { title: "Add tracks to playlist", ...WRITE },
		},
		async ({ playlistId, trackIds }) =>
			run(() => sc.addTracksToPlaylist(playlistId, trackIds), playlistLinks)
	);

	server.registerTool(
		"remove_track_from_playlist",
		{
			title: "Remove track from playlist",
			description: "Remove one track from a playlist.",
			inputSchema: { playlistId: id, trackId: id },
			annotations: { title: "Remove track from playlist", ...DESTRUCTIVE },
		},
		async ({ playlistId, trackId }) =>
			run(() => sc.removeTrackFromPlaylist(playlistId, trackId), playlistLinks)
	);

	server.registerTool(
		"delete_playlist",
		{
			title: "Delete playlist",
			description: "Delete a playlist permanently.",
			inputSchema: { playlistId: id },
			annotations: { title: "Delete playlist", ...DESTRUCTIVE },
		},
		async ({ playlistId }) =>
			run(async () => {
				await sc.deletePlaylist(playlistId);
				return `Deleted playlist ${playlistId}.`;
			})
	);

	registerPrompts(server, sc);
	registerResources(server, sc);
}

// A JSON resource body. Templates are not listable — there is no endpoint that
// enumerates every track — so `list` is undefined and clients read them by URI.
function json(uri: URL, data: unknown) {
	return {
		contents: [
			{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
		],
	};
}

function registerResources(server: McpServer, sc: SoundCloudClient): void {
	server.registerResource(
		"track",
		new ResourceTemplate("soundcloud://tracks/{id}", { list: undefined }),
		{ title: "Track", description: "A track by id or URN", mimeType: "application/json" },
		async (uri, { id }) => json(uri, await sc.getTrack(String(id)))
	);

	server.registerResource(
		"user",
		new ResourceTemplate("soundcloud://users/{id}", { list: undefined }),
		{ title: "User", description: "A user profile by id or URN", mimeType: "application/json" },
		async (uri, { id }) => json(uri, await sc.getUser(String(id)))
	);

	server.registerResource(
		"playlist",
		new ResourceTemplate("soundcloud://playlists/{id}", { list: undefined }),
		{ title: "Playlist", description: "A playlist by id or URN", mimeType: "application/json" },
		async (uri, { id }) => json(uri, await sc.getPlaylist(String(id)))
	);

	server.registerResource(
		"my-profile",
		"soundcloud://me/profile",
		{
			title: "My profile",
			description: "The connected user's profile",
			mimeType: "application/json",
		},
		async (uri) => json(uri, await sc.getMe())
	);

	server.registerResource(
		"my-playlists",
		"soundcloud://me/playlists",
		{
			title: "My playlists",
			description: "The connected user's playlists",
			mimeType: "application/json",
		},
		async (uri) => json(uri, await sc.getMyPlaylists(50))
	);

	server.registerResource(
		"my-likes",
		"soundcloud://me/likes",
		{
			title: "My likes",
			description: "The connected user's liked tracks",
			mimeType: "application/json",
		},
		async (uri) => json(uri, await sc.getMyLikes(50))
	);
}

function registerPrompts(server: McpServer, sc: SoundCloudClient): void {
	server.registerPrompt(
		"analyze_music_taste",
		{
			title: "Analyze music taste",
			description: "Analyze the connected user's taste from their liked tracks",
		},
		async () => {
			const likes = await sc.getMyLikes(50);
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: `Analyze my music taste based on these tracks I've liked:\n\n${JSON.stringify(likes, null, 2)}\n\nCall out genres, artists, and production qualities I gravitate toward.`,
						},
					},
				],
			};
		}
	);

	server.registerPrompt(
		"discover_similar_tracks",
		{
			title: "Discover similar tracks",
			description: "Find tracks similar to one you like",
			argsSchema: { trackId: z.string() },
		},
		async ({ trackId }) => {
			const [track, related] = await Promise.all([
				sc.getTrack(trackId),
				sc.getRelatedTracks(trackId, 20),
			]);
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: `Here's a track I like:\n\n${JSON.stringify(track, null, 2)}\n\nAnd tracks SoundCloud says are related:\n\n${JSON.stringify(related, null, 2)}\n\nExplain what they share and which three I'd most likely enjoy.`,
						},
					},
				],
			};
		}
	);

	server.registerPrompt(
		"discover_new_music",
		{
			title: "Discover new music",
			description: "Get personalized music discovery recommendations",
			argsSchema: { genres: z.string().optional(), mood: z.string().optional() },
		},
		async ({ genres, mood }) => {
			const seed = genres?.split(",")[0]?.trim();
			const [likes, search] = await Promise.all([
				sc.getMyLikes(20),
				seed ? sc.searchTracks({ q: seed, limit: 20 }) : Promise.resolve({ collection: [] }),
			]);
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: `I'm looking for new music${genres ? ` in these genres: ${genres}` : ""}${mood ? ` with a ${mood} mood` : ""}.\n\nTracks I've liked:\n${JSON.stringify(likes, null, 2)}\n\nSome tracks matching "${seed ?? ""}":\n${JSON.stringify(search, null, 2)}\n\nSuggest new tracks, artists, or genres I might enjoy and explain why.`,
						},
					},
				],
			};
		}
	);
}
