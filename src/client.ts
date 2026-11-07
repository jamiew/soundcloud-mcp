// Shared API client: token refresh, URN normalization, and cursor pagination.

import { z } from "zod";
import {
	CommentSchema,
	FeedItemSchema,
	PlaylistSchema,
	pageOf,
	TrackSchema,
	TrackStreamsSchema,
	UserSchema,
	WebProfileSchema,
} from "./types.js";

export const API_BASE = "https://api.soundcloud.com";
/** OAuth `/authorize` and `/oauth/token` live here, not on the API host. */
export const AUTH_BASE = "https://secure.soundcloud.com";

export class SoundCloudApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
		this.name = "SoundCloudApiError";
	}
}

/** Authorization is gone for good, e.g. a refresh failed or a second 401. */
export class SoundCloudAuthError extends Error {
	constructor(
		message = "SoundCloud authorization has lapsed. Reconnect this MCP server to SoundCloud."
	) {
		super(message);
		this.name = "SoundCloudAuthError";
	}
}

export class RateLimitedError extends Error {
	constructor(retryAfterSeconds?: number) {
		super(
			retryAfterSeconds === undefined
				? "SoundCloud is rate limiting right now. Wait a moment and try again."
				: `SoundCloud is rate limiting right now. Try again in ${retryAfterSeconds} seconds.`
		);
		this.name = "RateLimitedError";
	}
}

/** Reads Retry-After as delay seconds or an HTTP date. */
function retryAfterSeconds(header: string | null, now = Date.now()): number | undefined {
	if (!header) return undefined;
	const value = header.trim();
	if (/^\d+$/.test(value)) return Number(value);
	const date = Date.parse(value);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, Math.ceil((date - now) / 1000));
}

/** Upper bound for one API call, including token lookups and a retry after a refresh. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Waits for `work` until `signal` aborts. Only the wait stops: the work keeps
 * running, so a shared refresh still saves its single-use replacement token.
 */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	let onAbort = () => {};
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	return Promise.race([work, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}

export interface TokenProvider {
	getAccessToken(): Promise<string>;
	/** Forces a refresh after an unexpected 401. Returns the new token. */
	refreshAccessToken(): Promise<string>;
}

/** Normalize numeric or permalink-style ids to SoundCloud URNs. */
export function toUrn(kind: "tracks" | "users" | "playlists", idOrUrn: string | number): string {
	const raw = String(idOrUrn).trim();
	if (raw.startsWith("soundcloud:")) return raw;
	return `soundcloud:${kind}:${raw}`;
}

type Query = Record<string, string | number | boolean | undefined>;
type TrackSort = "asc" | "desc";
/** Likes and reposts are split by entity: /likes/tracks vs /likes/playlists. */
type LibraryKind = "tracks" | "playlists";
/** Only likes cover stations (system playlists). */
type LikeKind = LibraryKind | "stations";

const TrackPage = pageOf(TrackSchema);
const PlaylistPage = pageOf(PlaylistSchema);
const UserPage = pageOf(UserSchema);

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
		private readonly signal?: AbortSignal
	) {}

	/** A client whose requests also stop when `signal` aborts, such as a cancelled MCP call. */
	withSignal(signal: AbortSignal): SoundCloudClient {
		return new SoundCloudClient(this.tokens, this.baseUrl, this.fetchImpl, signal);
	}

	/** Sends one API call and returns the parsed JSON body, or undefined if it is empty. */
	async request(path: string, spec: RequestSpec = {}): Promise<unknown> {
		const url = path.startsWith("http") ? new URL(path) : new URL(this.baseUrl + path);
		// Every request carries the user's token, so never send one off the API host.
		if (url.origin !== new URL(this.baseUrl).origin) {
			throw new SoundCloudApiError("Only SoundCloud API URLs are allowed.", 400);
		}
		for (const [key, value] of Object.entries(spec.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}

		const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const signal = this.signal ? AbortSignal.any([this.signal, deadline]) : deadline;
		try {
			return await this.attempt(url.toString(), spec, signal);
		} catch (error) {
			if (deadline.aborted && !this.signal?.aborted) {
				throw new SoundCloudApiError("SoundCloud did not answer in time. Try again.", 504);
			}
			throw error;
		}
	}

	private async attempt(url: string, spec: RequestSpec, signal: AbortSignal): Promise<unknown> {
		let token = await abortable(this.tokens.getAccessToken(), signal);
		let refreshed = false;

		for (;;) {
			const response = await this.send(url, token, spec, signal);

			if (response.status === 401) {
				if (refreshed) throw new SoundCloudAuthError();
				refreshed = true;
				token = await abortable(this.tokens.refreshAccessToken(), signal);
				continue;
			}
			if (response.status === 429) {
				throw new RateLimitedError(retryAfterSeconds(response.headers.get("Retry-After")));
			}

			if (!response.ok) {
				const message =
					response.status >= 500
						? "SoundCloud is unavailable. Try again later."
						: "SoundCloud rejected the request. Check the inputs and your access.";
				throw new SoundCloudApiError(message, response.status);
			}

			if (response.status === 204) return undefined;
			const text = await response.text();
			return text ? JSON.parse(text) : undefined;
		}
	}

	private send(
		url: string,
		token: string,
		spec: RequestSpec,
		signal: AbortSignal
	): Promise<Response> {
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
			signal,
			...(body !== undefined ? { body } : {}),
		});
	}

	/** Checks the fields this server reads. Every other field passes through. */
	private async read<S extends z.ZodType>(
		schema: S,
		path: string,
		spec?: RequestSpec
	): Promise<z.output<S>> {
		const parsed = schema.safeParse(await this.request(path, spec));
		if (!parsed.success) {
			throw new SoundCloudApiError("SoundCloud sent a response this server cannot read.", 502);
		}
		return parsed.data;
	}

	// Cursor pagination: `next_href` is a fully-qualified URL, so it is fetched
	// as-is rather than being re-based onto the API root.
	private page<S extends z.ZodType>(schema: S, path: string, query: Query = {}) {
		return this.read(schema, path, { query: { linked_partitioning: true, ...query } });
	}

	/** Any endpoint can sit behind a next_href, so the result is left unchecked. */
	nextPage(nextHref: string): Promise<unknown> {
		return this.request(nextHref);
	}

	// --- Discovery ---
	searchTracks(query: Query & { q: string }) {
		return this.page(TrackPage, "/tracks", query);
	}
	searchPlaylists(q: string, limit: number) {
		return this.page(PlaylistPage, "/playlists", { q, limit });
	}
	searchUsers(q: string, limit: number) {
		return this.page(UserPage, "/users", { q, limit });
	}
	getTrack(id: string | number) {
		return this.read(TrackSchema, `/tracks/${toUrn("tracks", id)}`);
	}
	getUser(id: string | number) {
		return this.read(UserSchema, `/users/${toUrn("users", id)}`);
	}
	getPlaylist(id: string | number) {
		return this.read(PlaylistSchema, `/playlists/${toUrn("playlists", id)}`);
	}
	getPlaylistTracks(id: string | number, limit: number) {
		return this.page(TrackPage, `/playlists/${toUrn("playlists", id)}/tracks`, { limit });
	}
	getRelatedTracks(id: string | number, limit: number) {
		return this.read(z.array(TrackSchema), `/tracks/${toUrn("tracks", id)}/related`, {
			query: { limit },
		});
	}
	getRelatedArtists(id: string | number, limit: number) {
		return this.read(z.array(UserSchema), `/users/${toUrn("users", id)}/related`, {
			query: { limit },
		});
	}
	getUserTracks(id: string | number, limit: number, sort?: TrackSort) {
		return this.page(TrackPage, `/users/${toUrn("users", id)}/tracks`, { limit, sort });
	}
	getUserPlaylists(id: string | number, limit: number) {
		return this.page(PlaylistPage, `/users/${toUrn("users", id)}/playlists`, { limit });
	}
	// Paths are spelled out per kind so the api-sync audit can match each literal.
	getUserLikes(id: string | number, limit: number, kind: LikeKind = "tracks") {
		const user = toUrn("users", id);
		if (kind === "tracks") return this.page(TrackPage, `/users/${user}/likes/tracks`, { limit });
		const path =
			kind === "stations"
				? `/users/${user}/likes/system-playlists`
				: `/users/${user}/likes/playlists`;
		return this.page(PlaylistPage, path, { limit });
	}
	getUserReposts(id: string | number, limit: number, kind: LibraryKind = "tracks") {
		const user = toUrn("users", id);
		return kind === "playlists"
			? this.page(PlaylistPage, `/users/${user}/reposts/playlists`, { limit })
			: this.page(TrackPage, `/users/${user}/reposts/tracks`, { limit });
	}
	getUserFollowers(id: string | number, limit: number) {
		return this.page(UserPage, `/users/${toUrn("users", id)}/followers`, { limit });
	}
	getUserFollowings(id: string | number, limit: number) {
		return this.page(UserPage, `/users/${toUrn("users", id)}/followings`, { limit });
	}
	getUserWebProfiles(id: string | number, limit: number) {
		return this.read(z.array(WebProfileSchema), `/users/${toUrn("users", id)}/web-profiles`, {
			query: { limit },
		});
	}
	getTrackStreams(id: string | number) {
		return this.read(TrackStreamsSchema, `/tracks/${toUrn("tracks", id)}/streams`);
	}
	getComments(id: string | number, limit: number) {
		return this.page(pageOf(CommentSchema), `/tracks/${toUrn("tracks", id)}/comments`, {
			limit,
		});
	}
	/** SoundCloud still calls likers "favoriters" in this path. */
	getTrackLikers(id: string | number, limit: number) {
		return this.page(UserPage, `/tracks/${toUrn("tracks", id)}/favoriters`, { limit });
	}
	getTrackReposters(id: string | number, limit: number) {
		return this.page(UserPage, `/tracks/${toUrn("tracks", id)}/reposters`, { limit });
	}
	getPlaylistReposters(id: string | number, limit: number) {
		return this.page(UserPage, `/playlists/${toUrn("playlists", id)}/reposters`, { limit });
	}
	/** Takes a `soundcloud:system-playlists:…` URN or its `track-stations:{id}` part. */
	getSystemPlaylist(id: string) {
		return this.read(PlaylistSchema, `/system-playlists/${id.trim()}`);
	}
	/** Turns a soundcloud.com permalink into a track, user, playlist or station, unchecked. */
	resolve(url: string): Promise<unknown> {
		return this.request("/resolve", { query: { url } });
	}

	// --- Me / library ---
	getMe() {
		return this.read(UserSchema, "/me");
	}
	getMyLikes(limit: number, kind: LikeKind = "tracks") {
		if (kind === "tracks") return this.page(TrackPage, "/me/likes/tracks", { limit });
		const path = kind === "stations" ? "/me/likes/system-playlists" : "/me/likes/playlists";
		return this.page(PlaylistPage, path, { limit });
	}
	getMyReposts(limit: number, kind: LibraryKind = "tracks") {
		return kind === "playlists"
			? this.page(PlaylistPage, "/me/reposts/playlists", { limit })
			: this.page(TrackPage, "/me/reposts/tracks", { limit });
	}
	getMyPlaylists(limit: number) {
		return this.page(PlaylistPage, "/me/playlists", { limit });
	}
	getMyTracks(limit: number, sort?: TrackSort) {
		return this.page(TrackPage, "/me/tracks", { limit, sort });
	}
	getMyFollowings(limit: number) {
		return this.page(UserPage, "/me/followings", { limit });
	}
	getMyFollowers(limit: number) {
		return this.page(UserPage, "/me/followers", { limit });
	}
	// The spec deprecates this read in favor of /users/{urn}, which cannot
	// answer the follow question. 404 means "not followed" (or no such user).
	async isFollowing(id: string | number): Promise<boolean> {
		try {
			await this.request(`/me/followings/${toUrn("users", id)}`);
			return true;
		} catch (error) {
			if (error instanceof SoundCloudApiError && error.status === 404) return false;
			throw error;
		}
	}
	/** New tracks from people you follow — the closest thing to a home feed. */
	getFeed(limit: number, kind: "tracks" | "all" = "tracks") {
		return this.page(pageOf(FeedItemSchema), kind === "all" ? "/me/feed" : "/me/feed/tracks", {
			limit,
		});
	}
	/** This endpoint ignores `limit` and returns the whole history, so it is trimmed here. */
	async getRecentlyPlayed(limit: number) {
		const page = await this.page(TrackPage, "/me/recently-played/tracks", { limit });
		return { ...page, collection: page.collection.slice(0, limit) };
	}
	/** Revokes this app's access for the user and invalidates every token it issued them. */
	disconnect() {
		return this.request("/disconnect", { method: "POST" });
	}

	// --- Social writes ---
	likeTrack(id: string | number) {
		return this.request(`/likes/tracks/${toUrn("tracks", id)}`, { method: "POST" });
	}
	unlikeTrack(id: string | number) {
		return this.request(`/likes/tracks/${toUrn("tracks", id)}`, { method: "DELETE" });
	}
	repostTrack(id: string | number) {
		return this.request(`/reposts/tracks/${toUrn("tracks", id)}`, { method: "POST" });
	}
	unrepostTrack(id: string | number) {
		return this.request(`/reposts/tracks/${toUrn("tracks", id)}`, { method: "DELETE" });
	}
	likePlaylist(id: string | number) {
		return this.request(`/likes/playlists/${toUrn("playlists", id)}`, { method: "POST" });
	}
	unlikePlaylist(id: string | number) {
		return this.request(`/likes/playlists/${toUrn("playlists", id)}`, { method: "DELETE" });
	}
	repostPlaylist(id: string | number) {
		return this.request(`/reposts/playlists/${toUrn("playlists", id)}`, { method: "POST" });
	}
	unrepostPlaylist(id: string | number) {
		return this.request(`/reposts/playlists/${toUrn("playlists", id)}`, { method: "DELETE" });
	}
	followUser(id: string | number) {
		return this.request(`/me/followings/${toUrn("users", id)}`, { method: "PUT" });
	}
	unfollowUser(id: string | number) {
		return this.request(`/me/followings/${toUrn("users", id)}`, { method: "DELETE" });
	}
	addComment(id: string | number, body: string, timestamp?: number) {
		return this.read(CommentSchema, `/tracks/${toUrn("tracks", id)}/comments`, {
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
		return this.read(PlaylistSchema, "/playlists", {
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
		}
	) {
		const playlist: Record<string, unknown> = {};
		if (updates.title !== undefined) playlist.title = updates.title;
		if (updates.description !== undefined) playlist.description = updates.description;
		if (updates.sharing !== undefined) playlist.sharing = updates.sharing;
		if (updates.trackIds !== undefined) playlist.tracks = updates.trackIds.map(playlistTrackRef);
		return this.read(PlaylistSchema, `/playlists/${toUrn("playlists", id)}`, {
			method: "PUT",
			body: { playlist },
		});
	}

	deletePlaylist(id: string | number) {
		return this.request(`/playlists/${toUrn("playlists", id)}`, { method: "DELETE" });
	}

	/**
	 * Reads every track id for a read-modify-write. The playlist GET omits blocked
	 * tracks unless asked, and a PUT without them deletes them. Tracks the API
	 * never returns (track_count is higher) or returns without an id would also
	 * be deleted, so refuse.
	 */
	private async getTracklist(id: string | number): Promise<(string | number)[]> {
		const playlist = await this.read(PlaylistSchema, `/playlists/${toUrn("playlists", id)}`, {
			query: { access: "playable,preview,blocked" },
		});
		const tracks = playlist.tracks ?? [];
		const ids = tracks.flatMap((track) => {
			const ref = track.urn ?? track.id;
			return ref == null ? [] : [ref];
		});
		if (ids.length < Math.max(tracks.length, playlist.track_count ?? 0)) {
			throw new SoundCloudApiError(
				"SoundCloud hides some tracks in this playlist, and changing it here would delete them. Edit it on soundcloud.com instead.",
				409
			);
		}
		return ids;
	}

	/** SoundCloud has no append endpoint; the whole tracklist must be re-sent. */
	async addTracksToPlaylist(id: string | number, trackIds: (string | number)[]) {
		const ids = [...(await this.getTracklist(id)), ...trackIds];
		return this.updatePlaylist(id, { trackIds: ids });
	}

	async removeTrackFromPlaylist(id: string | number, trackId: string | number) {
		const target = toUrn("tracks", trackId);
		const ids = (await this.getTracklist(id)).filter((each) => toUrn("tracks", each) !== target);
		return this.updatePlaylist(id, { trackIds: ids });
	}
}

// SoundCloud mangles track IDs above int32 when they arrive as JSON numbers in
// a playlist body (returns 422), so every ref is sent as a URN string.
function playlistTrackRef(id: string | number): { urn: string } {
	return { urn: toUrn("tracks", id) };
}
