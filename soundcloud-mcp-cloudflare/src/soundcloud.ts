// SoundCloud public API client for the Worker runtime: transparent 401
// refresh-and-retry, URN normalization, and cursor pagination.

import type {
	FeedItem,
	Paginated,
	SoundCloudComment,
	SoundCloudPlaylist,
	SoundCloudTrack,
	SoundCloudUser,
	TrackStreams,
} from "./types";

export const API_BASE = "https://api.soundcloud.com";

export class SoundCloudApiError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "SoundCloudApiError";
	}
}

/** Authorization is gone for good (refresh failed, or a second 401). */
export class SoundCloudAuthError extends Error {
	constructor() {
		super("SoundCloud authorization has lapsed. Reconnect this MCP server to SoundCloud.");
		this.name = "SoundCloudAuthError";
	}
}

export class RateLimitedError extends Error {
	constructor() {
		super("SoundCloud is rate limiting right now. Wait a moment and try again.");
		this.name = "RateLimitedError";
	}
}

export interface TokenProvider {
	getAccessToken(): Promise<string>;
	/** Forces a refresh after an unexpected 401. Returns the new token. */
	refreshAccessToken(): Promise<string>;
}

/**
 * SoundCloud's own agent guidance says numeric IDs are deprecated in favour of
 * URNs, so every id that reaches a path gets normalized here. Bare numbers and
 * permalink-style ids both become `soundcloud:<kind>:<id>`.
 */
export function toUrn(kind: "tracks" | "users" | "playlists", idOrUrn: string | number): string {
	const raw = String(idOrUrn).trim();
	if (raw.startsWith("soundcloud:")) return raw;
	return `soundcloud:${kind}:${raw}`;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestSpec {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	query?: Query;
	body?: unknown;
}

export class SoundCloudClient {
	constructor(
		private readonly tokens: TokenProvider,
		private readonly baseUrl: string = API_BASE,
		// Must stay bound: Workers throws "Illegal invocation" if the global fetch
		// is called with anything but the global object as `this`.
		private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
	) {}

	async request<T>(path: string, spec: RequestSpec = {}): Promise<T> {
		const url = path.startsWith("http") ? new URL(path) : new URL(this.baseUrl + path);
		for (const [key, value] of Object.entries(spec.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}

		let token = await this.tokens.getAccessToken();
		let refreshed = false;

		for (;;) {
			const response = await this.send(url.toString(), token, spec);

			if (response.status === 401) {
				if (refreshed) throw new SoundCloudAuthError();
				refreshed = true;
				token = await this.tokens.refreshAccessToken();
				continue;
			}
			if (response.status === 429) throw new RateLimitedError();

			if (!response.ok) {
				throw new SoundCloudApiError(
					await this.errorMessage(response, spec.method ?? "GET", path),
					response.status,
				);
			}

			if (response.status === 204) return undefined as T;
			const text = await response.text();
			return (text ? JSON.parse(text) : undefined) as T;
		}
	}

	private send(url: string, token: string, spec: RequestSpec): Promise<Response> {
		const headers: Record<string, string> = {
			// SoundCloud uses the `OAuth` scheme, not `Bearer`.
			Authorization: `OAuth ${token}`,
			accept: "application/json; charset=utf-8",
		};
		let body: string | undefined;
		if (spec.body !== undefined) {
			headers["Content-Type"] = "application/json";
			body = JSON.stringify(spec.body);
		}
		return this.fetchImpl(url, {
			method: spec.method ?? "GET",
			headers,
			...(body !== undefined ? { body } : {}),
		});
	}

	private async errorMessage(response: Response, method: string, path: string): Promise<string> {
		const fallback = `SoundCloud returned ${response.status} for ${method} ${path}`;
		try {
			const body: unknown = await response.json();
			if (typeof body === "object" && body !== null) {
				const record = body as Record<string, unknown>;
				if (typeof record.message === "string" && record.message) return record.message;
				const errors = record.errors;
				if (Array.isArray(errors) && errors.length > 0) {
					const first = errors[0] as Record<string, unknown>;
					if (typeof first?.error_message === "string") return first.error_message;
				}
			}
			return fallback;
		} catch {
			return fallback;
		}
	}

	// Cursor pagination: `next_href` is a fully-qualified URL, so it is fetched
	// as-is rather than being re-based onto the API root.
	page<T>(path: string, query: Query = {}): Promise<Paginated<T>> {
		return this.request<Paginated<T>>(path, {
			query: { linked_partitioning: true, ...query },
		});
	}

	nextPage<T>(nextHref: string): Promise<Paginated<T>> {
		return this.request<Paginated<T>>(nextHref);
	}

	// --- Discovery ---
	searchTracks(query: Query & { q: string }) {
		return this.page<SoundCloudTrack>("/tracks", query);
	}
	searchPlaylists(q: string, limit: number) {
		return this.page<SoundCloudPlaylist>("/playlists", { q, limit });
	}
	searchUsers(q: string, limit: number) {
		return this.page<SoundCloudUser>("/users", { q, limit });
	}
	getTrack(id: string | number) {
		return this.request<SoundCloudTrack>(`/tracks/${toUrn("tracks", id)}`);
	}
	getUser(id: string | number) {
		return this.request<SoundCloudUser>(`/users/${toUrn("users", id)}`);
	}
	getPlaylist(id: string | number) {
		return this.request<SoundCloudPlaylist>(`/playlists/${toUrn("playlists", id)}`);
	}
	getPlaylistTracks(id: string | number, limit: number) {
		return this.page<SoundCloudTrack>(`/playlists/${toUrn("playlists", id)}/tracks`, { limit });
	}
	getRelatedTracks(id: string | number, limit: number) {
		return this.request<SoundCloudTrack[]>(`/tracks/${toUrn("tracks", id)}/related`, {
			query: { limit },
		});
	}
	getRelatedArtists(id: string | number, limit: number) {
		return this.request<SoundCloudUser[]>(`/users/${toUrn("users", id)}/related`, {
			query: { limit },
		});
	}
	getUserTracks(id: string | number, limit: number) {
		return this.page<SoundCloudTrack>(`/users/${toUrn("users", id)}/tracks`, { limit });
	}
	getUserPlaylists(id: string | number, limit: number) {
		return this.page<SoundCloudPlaylist>(`/users/${toUrn("users", id)}/playlists`, { limit });
	}
	getUserLikes(id: string | number, limit: number) {
		return this.page<SoundCloudTrack>(`/users/${toUrn("users", id)}/likes/tracks`, { limit });
	}
	getTrackStreams(id: string | number) {
		return this.request<TrackStreams>(`/tracks/${toUrn("tracks", id)}/streams`);
	}
	getComments(id: string | number, limit: number) {
		return this.page<SoundCloudComment>(`/tracks/${toUrn("tracks", id)}/comments`, { limit });
	}
	/** Turns a soundcloud.com permalink into the underlying API resource. */
	resolve(url: string) {
		return this.request<SoundCloudTrack | SoundCloudUser | SoundCloudPlaylist>("/resolve", {
			query: { url },
		});
	}

	// --- Me / library ---
	getMe() {
		return this.request<SoundCloudUser>("/me");
	}
	getMyLikes(limit: number) {
		return this.page<SoundCloudTrack>("/me/likes/tracks", { limit });
	}
	getMyPlaylists(limit: number) {
		return this.page<SoundCloudPlaylist>("/me/playlists", { limit });
	}
	getMyTracks(limit: number) {
		return this.page<SoundCloudTrack>("/me/tracks", { limit });
	}
	getMyFollowings(limit: number) {
		return this.page<SoundCloudUser>("/me/followings", { limit });
	}
	/** New tracks from people you follow — the closest thing to a home feed. */
	getFeed(limit: number) {
		return this.page<FeedItem>("/me/feed/tracks", { limit });
	}
	getRecentlyPlayed(limit: number) {
		return this.page<SoundCloudTrack>("/me/recently-played/tracks", { limit });
	}

	// --- Social writes ---
	likeTrack(id: string | number) {
		return this.request<void>(`/likes/tracks/${toUrn("tracks", id)}`, { method: "POST" });
	}
	unlikeTrack(id: string | number) {
		return this.request<void>(`/likes/tracks/${toUrn("tracks", id)}`, { method: "DELETE" });
	}
	repostTrack(id: string | number) {
		return this.request<void>(`/reposts/tracks/${toUrn("tracks", id)}`, { method: "POST" });
	}
	unrepostTrack(id: string | number) {
		return this.request<void>(`/reposts/tracks/${toUrn("tracks", id)}`, { method: "DELETE" });
	}
	followUser(id: string | number) {
		return this.request<void>(`/me/followings/${toUrn("users", id)}`, { method: "PUT" });
	}
	unfollowUser(id: string | number) {
		return this.request<void>(`/me/followings/${toUrn("users", id)}`, { method: "DELETE" });
	}
	addComment(id: string | number, body: string, timestamp?: number) {
		return this.request<SoundCloudComment>(`/tracks/${toUrn("tracks", id)}/comments`, {
			method: "POST",
			body: { comment: { body, ...(timestamp !== undefined ? { timestamp } : {}) } },
		});
	}

	// --- Playlist writes ---
	createPlaylist(opts: {
		title: string;
		description?: string;
		sharing: "public" | "private";
		trackIds?: (string | number)[];
	}) {
		return this.request<SoundCloudPlaylist>("/playlists", {
			method: "POST",
			body: {
				playlist: {
					title: opts.title,
					sharing: opts.sharing,
					...(opts.description !== undefined ? { description: opts.description } : {}),
					...(opts.trackIds ? { tracks: opts.trackIds.map(playlistTrackRef) } : {}),
				},
			},
		});
	}

	updatePlaylist(
		id: string | number,
		updates: {
			title?: string;
			description?: string;
			sharing?: "public" | "private";
			trackIds?: (string | number)[];
		},
	) {
		const playlist: Record<string, unknown> = {};
		if (updates.title !== undefined) playlist.title = updates.title;
		if (updates.description !== undefined) playlist.description = updates.description;
		if (updates.sharing !== undefined) playlist.sharing = updates.sharing;
		if (updates.trackIds !== undefined) playlist.tracks = updates.trackIds.map(playlistTrackRef);
		return this.request<SoundCloudPlaylist>(`/playlists/${toUrn("playlists", id)}`, {
			method: "PUT",
			body: { playlist },
		});
	}

	deletePlaylist(id: string | number) {
		return this.request<void>(`/playlists/${toUrn("playlists", id)}`, { method: "DELETE" });
	}

	/** SoundCloud has no append endpoint; the whole tracklist must be re-sent. */
	async addTracksToPlaylist(id: string | number, trackIds: (string | number)[]) {
		const existing = await this.getPlaylist(id);
		const ids = [...(existing.tracks ?? []).map((t) => t.urn ?? t.id), ...trackIds];
		return this.updatePlaylist(id, { trackIds: ids });
	}

	async removeTrackFromPlaylist(id: string | number, trackId: string | number) {
		const existing = await this.getPlaylist(id);
		const target = toUrn("tracks", trackId);
		const ids = (existing.tracks ?? [])
			.map((t) => t.urn ?? t.id)
			.filter((each) => toUrn("tracks", each) !== target);
		return this.updatePlaylist(id, { trackIds: ids });
	}
}

// SoundCloud mangles track IDs above int32 when they arrive as JSON numbers in
// a playlist body (returns 422), so every ref is sent as a URN string.
function playlistTrackRef(id: string | number): { urn: string } {
	return { urn: toUrn("tracks", id) };
}
