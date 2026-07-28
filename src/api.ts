import { API_BASE } from "./stdio/config.js";
import { debug } from "./stdio/log.js";
import type {
	Comment,
	FeedItem,
	PaginatedResponse,
	SoundCloudError,
	SoundCloudLike,
	SoundCloudPlaylist,
	SoundCloudTrack,
	SoundCloudUser,
	TrackStreams,
} from "./types.js";

export type TokenProvider = () => Promise<string>;

/** Ids accepted from tools: a numeric id or a `soundcloud:…` URN. */
export type Id = string | number;

// SoundCloud's agent guidance deprecates numeric ids in favour of URNs, so
// every id is normalized before it reaches a path. This also sidesteps the old
// int32 bug: ids above 2^31 were mangled when sent as JSON numbers.
export function toUrn(kind: "tracks" | "users" | "playlists", id: Id): string {
	const raw = String(id).trim();
	return raw.startsWith("soundcloud:") ? raw : `soundcloud:${kind}:${raw}`;
}

function playlistTrackRef(id: Id): { urn: string } {
	return { urn: toUrn("tracks", id) };
}

export class SoundCloudAPI {
	private getToken: TokenProvider;
	private baseUrl = API_BASE;

	// Accepts an async provider so every request uses a current (auto-refreshed)
	// token rather than one captured once at startup.
	constructor(tokenProvider: TokenProvider) {
		this.getToken = tokenProvider;
	}

	public async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
		const token = await this.getToken();
		const headers = {
			accept: "application/json; charset=utf-8",
			Authorization: `OAuth ${token}`,
			...options.headers,
		};

		const startTime = Date.now();
		const response = await fetch(url, { ...options, headers });
		debug(`${options.method ?? "GET"} ${path} -> ${response.status} (${Date.now() - startTime}ms)`);

		if (!response.ok) {
			let message = `API request failed (${response.status})`;
			try {
				const error = (await response.json()) as SoundCloudError;
				message = error.message || error.errors?.[0]?.error_message || message;
			} catch {
				// non-JSON error body
			}
			// A 401 on a personal endpoint almost always means no user is logged in.
			if (response.status === 401) {
				message +=
					" — log in with the connect_soundcloud tool (or `pnpm run auth`) for personal data.";
			}
			throw new Error(message);
		}

		// Some write endpoints return 200/201 with an empty body.
		if (response.status === 204) return undefined as T;
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	// Collection endpoints need linked_partitioning to return a next_href cursor.
	private page<T>(path: string, params: Record<string, string | number> = {}) {
		const query = new URLSearchParams({ linked_partitioning: "true" });
		for (const [key, value] of Object.entries(params)) query.append(key, String(value));
		return this.request<PaginatedResponse<T>>(`${path}?${query.toString()}`);
	}

	// --- Discovery ---
	async searchTracks(
		query: string,
		limit = 50,
		filters?: {
			genres?: string[];
			tags?: string[];
			bpmFrom?: number;
			bpmTo?: number;
			durationFrom?: number;
			durationTo?: number;
			access?: ("playable" | "preview" | "blocked")[];
		}
	): Promise<PaginatedResponse<SoundCloudTrack>> {
		const params = new URLSearchParams({
			q: query,
			limit: limit.toString(),
			linked_partitioning: "true",
		});
		if (filters?.genres?.length) params.append("genres", filters.genres.join(","));
		if (filters?.tags?.length) params.append("tags", filters.tags.join(","));
		if (filters?.bpmFrom) params.append("bpm[from]", filters.bpmFrom.toString());
		if (filters?.bpmTo) params.append("bpm[to]", filters.bpmTo.toString());
		if (filters?.durationFrom) params.append("duration[from]", filters.durationFrom.toString());
		if (filters?.durationTo) params.append("duration[to]", filters.durationTo.toString());
		if (filters?.access?.length) params.append("access", filters.access.join(","));
		return this.request<PaginatedResponse<SoundCloudTrack>>(`/tracks?${params.toString()}`);
	}

	async searchPlaylists(query: string, limit = 50): Promise<PaginatedResponse<SoundCloudPlaylist>> {
		return this.page<SoundCloudPlaylist>("/playlists", { q: query, limit });
	}

	async searchUsers(query: string, limit = 50): Promise<PaginatedResponse<SoundCloudUser>> {
		return this.page<SoundCloudUser>("/users", { q: query, limit });
	}

	// Turns a soundcloud.com permalink into the underlying API resource.
	async resolve(url: string): Promise<SoundCloudTrack | SoundCloudUser | SoundCloudPlaylist> {
		return this.request(`/resolve?url=${encodeURIComponent(url)}`);
	}

	async getTrack(trackId: Id): Promise<SoundCloudTrack> {
		return this.request<SoundCloudTrack>(`/tracks/${toUrn("tracks", trackId)}`);
	}

	async getUser(userId: Id): Promise<SoundCloudUser> {
		return this.request<SoundCloudUser>(`/users/${toUrn("users", userId)}`);
	}

	async getRelatedTracks(trackId: Id, limit = 50): Promise<SoundCloudTrack[]> {
		return this.request<SoundCloudTrack[]>(
			`/tracks/${toUrn("tracks", trackId)}/related?limit=${limit}`
		);
	}

	async getRelatedArtists(userId: Id, limit = 50): Promise<SoundCloudUser[]> {
		return this.request<SoundCloudUser[]>(
			`/users/${toUrn("users", userId)}/related?limit=${limit}`
		);
	}

	async getUserTracks(userId: Id, limit = 50): Promise<PaginatedResponse<SoundCloudTrack>> {
		return this.page<SoundCloudTrack>(`/users/${toUrn("users", userId)}/tracks`, { limit });
	}

	async getUserLikes(userId: Id, limit = 50): Promise<PaginatedResponse<SoundCloudTrack>> {
		return this.page<SoundCloudTrack>(`/users/${toUrn("users", userId)}/likes/tracks`, { limit });
	}

	async getTrackStreams(trackId: Id): Promise<TrackStreams> {
		return this.request<TrackStreams>(`/tracks/${toUrn("tracks", trackId)}/streams`);
	}

	async getTrackComments(trackId: Id, limit = 50): Promise<PaginatedResponse<Comment>> {
		return this.page<Comment>(`/tracks/${toUrn("tracks", trackId)}/comments`, { limit });
	}

	// --- Social ---
	async likeTrack(trackId: Id): Promise<void> {
		await this.request<void>(`/likes/tracks/${toUrn("tracks", trackId)}`, { method: "POST" });
	}

	async unlikeTrack(trackId: Id): Promise<void> {
		await this.request<void>(`/likes/tracks/${toUrn("tracks", trackId)}`, { method: "DELETE" });
	}

	async repostTrack(trackId: Id): Promise<void> {
		await this.request<void>(`/reposts/tracks/${toUrn("tracks", trackId)}`, { method: "POST" });
	}

	async unrepostTrack(trackId: Id): Promise<void> {
		await this.request<void>(`/reposts/tracks/${toUrn("tracks", trackId)}`, { method: "DELETE" });
	}

	async followUser(userId: Id): Promise<void> {
		await this.request<void>(`/me/followings/${toUrn("users", userId)}`, { method: "PUT" });
	}

	async unfollowUser(userId: Id): Promise<void> {
		await this.request<void>(`/me/followings/${toUrn("users", userId)}`, { method: "DELETE" });
	}

	async addComment(trackId: Id, body: string, timestamp?: number): Promise<void> {
		await this.request<void>(`/tracks/${toUrn("tracks", trackId)}/comments`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ comment: { body, timestamp } }),
		});
	}

	// --- Me / library ---
	async getCurrentUser(): Promise<SoundCloudUser> {
		return this.request<SoundCloudUser>("/me");
	}

	async getMyLikes(limit = 50): Promise<PaginatedResponse<SoundCloudLike>> {
		return this.page<SoundCloudLike>("/me/likes/tracks", { limit });
	}

	async getMyPlaylists(limit = 50): Promise<PaginatedResponse<SoundCloudPlaylist>> {
		return this.page<SoundCloudPlaylist>("/me/playlists", { limit });
	}

	async getMyTracks(limit = 50): Promise<PaginatedResponse<SoundCloudTrack>> {
		return this.page<SoundCloudTrack>("/me/tracks", { limit });
	}

	async getMyFollowings(limit = 50): Promise<PaginatedResponse<SoundCloudUser>> {
		return this.page<SoundCloudUser>("/me/followings", { limit });
	}

	// New tracks from people you follow — the closest thing to a home feed, and
	// the nearest replacement for the removed /me/recommended/tracks endpoint.
	async getFeed(limit = 50): Promise<PaginatedResponse<FeedItem>> {
		return this.page<FeedItem>("/me/feed/tracks", { limit });
	}

	// This endpoint ignores `limit` and returns the whole history, so it is trimmed here.
	async getRecentlyPlayed(limit = 50): Promise<PaginatedResponse<SoundCloudTrack>> {
		const page = await this.page<SoundCloudTrack>("/me/recently-played/tracks", { limit });
		return { ...page, collection: page.collection.slice(0, limit) };
	}

	async getPlaylist(playlistId: Id): Promise<SoundCloudPlaylist> {
		return this.request<SoundCloudPlaylist>(`/playlists/${toUrn("playlists", playlistId)}`);
	}

	async getPlaylistTracks(playlistId: Id, limit = 50): Promise<PaginatedResponse<SoundCloudTrack>> {
		return this.page<SoundCloudTrack>(`/playlists/${toUrn("playlists", playlistId)}/tracks`, {
			limit,
		});
	}

	// next_href is an absolute URL, so it is fetched as-is.
	async getNextPage<T>(nextHref: string): Promise<PaginatedResponse<T>> {
		return this.request<PaginatedResponse<T>>(nextHref);
	}

	// --- Playlist writes ---
	async createPlaylist(
		title: string,
		options: { description?: string; sharing?: "public" | "private"; trackIds?: Id[] } = {}
	): Promise<SoundCloudPlaylist> {
		const playlist: Record<string, unknown> = {
			title,
			sharing: options.sharing ?? "private",
		};
		if (options.description) playlist.description = options.description;
		if (options.trackIds) playlist.tracks = options.trackIds.map(playlistTrackRef);
		return this.request<SoundCloudPlaylist>("/playlists", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ playlist }),
		});
	}

	async updatePlaylist(
		playlistId: Id,
		updates: {
			title?: string;
			description?: string;
			sharing?: "public" | "private";
			trackIds?: Id[];
		}
	): Promise<SoundCloudPlaylist> {
		const playlist: Record<string, unknown> = {};
		if (updates.title !== undefined) playlist.title = updates.title;
		if (updates.description !== undefined) playlist.description = updates.description;
		if (updates.sharing !== undefined) playlist.sharing = updates.sharing;
		if (updates.trackIds !== undefined) playlist.tracks = updates.trackIds.map(playlistTrackRef);
		return this.request<SoundCloudPlaylist>(`/playlists/${toUrn("playlists", playlistId)}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ playlist }),
		});
	}

	// SoundCloud has no append endpoint; the full track list must be re-sent.
	async addTracksToPlaylist(playlistId: Id, trackIds: Id[]): Promise<SoundCloudPlaylist> {
		const existing = await this.getPlaylist(playlistId);
		const ids = [...(existing.tracks ?? []).map((t) => t.urn ?? t.id), ...trackIds];
		return this.updatePlaylist(playlistId, { trackIds: ids });
	}

	async removeTrackFromPlaylist(playlistId: Id, trackId: Id): Promise<SoundCloudPlaylist> {
		const existing = await this.getPlaylist(playlistId);
		const target = toUrn("tracks", trackId);
		const ids = (existing.tracks ?? [])
			.map((t) => t.urn ?? t.id)
			.filter((id) => toUrn("tracks", id) !== target);
		return this.updatePlaylist(playlistId, { trackIds: ids });
	}

	async deletePlaylist(playlistId: Id): Promise<void> {
		await this.request<void>(`/playlists/${toUrn("playlists", playlistId)}`, { method: "DELETE" });
	}
}
