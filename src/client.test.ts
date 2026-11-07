import { afterEach, describe, expect, it, vi } from "vitest";
import {
	RateLimitedError,
	REQUEST_TIMEOUT_MS,
	SoundCloudAuthError,
	SoundCloudClient,
	toUrn,
} from "./client.js";

/** A token provider that counts refreshes, so retry behavior is observable. */
function tokens(initial = "tok-1") {
	const state = { current: initial, refreshes: 0 };
	return {
		state,
		provider: {
			getAccessToken: async () => state.current,
			refreshAccessToken: async () => {
				state.refreshes += 1;
				state.current = `tok-${state.refreshes + 1}`;
				return state.current;
			},
		},
	};
}

/** Replays the given responses in order and records the requests made. */
function stubFetch(responses: Response[]) {
	const calls: { url: string; init: RequestInit }[] = [];
	const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
		calls.push({ url: String(url), init });
		const next = responses.shift();
		if (!next) throw new Error("stub fetch ran out of responses");
		return next;
	}) as unknown as typeof fetch;
	return { calls, impl };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that never answers, like a stalled upstream, until its signal aborts. */
const stalledFetch = (async (_url: string | URL | Request, init: RequestInit = {}) => {
	const { promise, reject } = Promise.withResolvers<Response>();
	const signal = init.signal;
	if (signal?.aborted) reject(signal.reason);
	signal?.addEventListener("abort", () => reject(signal.reason));
	return promise;
}) as unknown as typeof fetch;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("toUrn", () => {
	it("normalizes numeric and string ids to URNs", () => {
		expect(toUrn("tracks", 3419282)).toBe("soundcloud:tracks:3419282");
		expect(toUrn("tracks", "3419282")).toBe("soundcloud:tracks:3419282");
		expect(toUrn("users", 34532)).toBe("soundcloud:users:34532");
	});

	it("passes existing URNs through untouched", () => {
		expect(toUrn("tracks", "soundcloud:tracks:99")).toBe("soundcloud:tracks:99");
	});
});

describe("SoundCloudClient", () => {
	it("sends the OAuth authorization scheme, not Bearer", async () => {
		const { impl, calls } = stubFetch([json({ id: 1 })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.getMe();

		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("OAuth tok-1");
	});

	it("refreshes once on a 401 and retries with the new token", async () => {
		const { impl, calls } = stubFetch([json({ error: "expired" }, 401), json({ id: 1 })]);
		const auth = tokens();
		const client = new SoundCloudClient(auth.provider, undefined, impl);

		await expect(client.getMe()).resolves.toEqual({ id: 1 });

		expect(auth.state.refreshes).toBe(1);
		const retryHeaders = calls[1]?.init.headers as Record<string, string>;
		expect(retryHeaders.Authorization).toBe("OAuth tok-2");
	});

	it("gives up with an auth error when the retry also 401s", async () => {
		const { impl } = stubFetch([json({}, 401), json({}, 401)]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.getMe()).rejects.toBeInstanceOf(SoundCloudAuthError);
	});

	it("surfaces rate limiting as its own error", async () => {
		const { impl } = stubFetch([json({}, 429)]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.getMe()).rejects.toBeInstanceOf(RateLimitedError);
	});

	it("says how long to wait when SoundCloud sends Retry-After", async () => {
		const limited = (retryAfter: string) =>
			new Response("{}", { status: 429, headers: { "Retry-After": retryAfter } });
		const inTwoMinutes = new Date(Date.now() + 120_000).toUTCString();
		const { impl } = stubFetch([limited("30"), limited(inTwoMinutes), limited("soon")]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.getMe()).rejects.toThrow("Try again in 30 seconds.");
		await expect(client.getMe()).rejects.toThrow(/Try again in 1(19|20) seconds\./);
		await expect(client.getMe()).rejects.toThrow("Wait a moment");
	});

	it("gives up on a stalled request at the deadline", async () => {
		const deadline = new AbortController();
		const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const client = new SoundCloudClient(tokens().provider, undefined, stalledFetch);

		const pending = client.getMe();
		deadline.abort(new DOMException("timed out", "TimeoutError"));

		await expect(pending).rejects.toMatchObject({ status: 504, message: expect.any(String) });
		expect(timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
	});

	it("stops a request when the MCP call is cancelled", async () => {
		const cancel = new AbortController();
		const client = new SoundCloudClient(tokens().provider, undefined, stalledFetch).withSignal(
			cancel.signal
		);

		const pending = client.getMe();
		cancel.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});

	// A token provider can stall too, e.g. on a slow refresh. The caller must
	// still be released by the deadline or a cancellation.
	it("gives up on a stalled token lookup at the deadline", async () => {
		const stalled = () => Promise.withResolvers<string>().promise;
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const client = new SoundCloudClient(
			{ getAccessToken: stalled, refreshAccessToken: stalled },
			undefined,
			stalledFetch
		);

		const pending = client.getMe();
		deadline.abort(new DOMException("timed out", "TimeoutError"));

		await expect(pending).rejects.toMatchObject({ status: 504 });
	});

	it("stops waiting for a stalled refresh when the MCP call is cancelled", async () => {
		const refreshStarted = Promise.withResolvers<void>();
		const provider = {
			getAccessToken: async () => "tok-1",
			refreshAccessToken: () => {
				refreshStarted.resolve();
				return Promise.withResolvers<string>().promise;
			},
		};
		const cancel = new AbortController();
		const { impl } = stubFetch([json({}, 401)]);
		const client = new SoundCloudClient(provider, undefined, impl).withSignal(cancel.signal);

		const pending = client.getMe();
		await refreshStarted.promise;
		cancel.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});

	it("keeps upstream error details out of client-facing errors", async () => {
		const detail = "Internal request details that must stay private";
		const { impl } = stubFetch([json({ message: detail }, 422)]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.getPlaylist(5)).rejects.toMatchObject({
			status: 422,
			message: expect.not.stringContaining(detail),
		});
	});

	it("asks for cursor pagination on collection endpoints", async () => {
		const { impl, calls } = stubFetch([json({ collection: [] })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.getMyLikes(10);

		expect(calls[0]?.url).toContain("linked_partitioning=true");
		expect(calls[0]?.url).toContain("limit=10");
	});

	it("passes track sort order for user upload endpoints", async () => {
		const { impl, calls } = stubFetch([json({ collection: [] }), json({ collection: [] })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.getUserTracks(42, 10, "asc");
		await client.getMyTracks(10, "asc");

		expect(calls[0]?.url).toContain("sort=asc");
		expect(calls[1]?.url).toContain("sort=asc");
	});

	it("splits likes and reposts by kind, defaulting to tracks", async () => {
		const { impl, calls } = stubFetch(Array.from({ length: 6 }, () => json({ collection: [] })));
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.getMyLikes(10);
		await client.getMyReposts(10, "playlists");
		await client.getUserLikes(42, 10, "playlists");
		await client.getUserReposts(42, 10);
		await client.getMyLikes(10, "stations");
		await client.getUserLikes(42, 10, "stations");

		expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
			"/me/likes/tracks",
			"/me/reposts/playlists",
			"/users/soundcloud:users:42/likes/playlists",
			"/users/soundcloud:users:42/reposts/tracks",
			"/me/likes/system-playlists",
			"/users/soundcloud:users:42/likes/system-playlists",
		]);
	});

	it("fetches stations by URN without rewriting it as a playlist URN", async () => {
		const { impl, calls } = stubFetch([json({ urn: "x" })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.getSystemPlaylist("soundcloud:system-playlists:artist-stations:34532");

		expect(calls[0]?.url).toBe(
			"https://api.soundcloud.com/system-playlists/soundcloud:system-playlists:artist-stations:34532"
		);
	});

	it("reads follow status from a 200 or 404", async () => {
		const { impl, calls } = stubFetch([json({ id: 42 }), json({}, 404)]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.isFollowing(42)).resolves.toBe(true);
		await expect(client.isFollowing(43)).resolves.toBe(false);

		expect(calls[0]?.url).toBe("https://api.soundcloud.com/me/followings/soundcloud:users:42");
	});

	it("follows a next_href cursor as an absolute URL", async () => {
		const { impl, calls } = stubFetch([json({ collection: [] })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.nextPage("https://api.soundcloud.com/me/likes/tracks?cursor=abc");

		expect(calls[0]?.url).toBe("https://api.soundcloud.com/me/likes/tracks?cursor=abc");
	});

	it("never sends the token to a host other than the API", async () => {
		const { impl, calls } = stubFetch([]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.nextPage("https://evil.example/steal")).rejects.toThrow(
			"Only SoundCloud API URLs"
		);
		await expect(client.nextPage("http://api.soundcloud.com/me")).rejects.toThrow();
		await expect(client.request("@evil.example/steal")).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});

	it("sends playlist tracks as URN refs, which survive ids above int32", async () => {
		const { impl, calls } = stubFetch([json({ id: 7 })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.createPlaylist({ title: "test", sharing: "private", trackIds: [2303720966] });

		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			playlist: {
				title: "test",
				sharing: "private",
				tracks: [{ urn: "soundcloud:tracks:2303720966" }],
			},
		});
	});

	// There is no append endpoint, so both of these read the playlist and PUT the
	// whole tracklist back. Dropping an id here silently deletes someone's tracks.
	it("appends to a playlist by re-sending the existing ids plus the new ones", async () => {
		const { impl, calls } = stubFetch([
			json({ id: 7, track_count: 1, tracks: [{ id: 1, urn: "soundcloud:tracks:1" }] }),
			json({ id: 7 }),
		]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.addTracksToPlaylist(7, [2]);

		// The GET hides blocked tracks by default, and the PUT would then drop them.
		expect(new URL(calls[0]?.url ?? "").searchParams.get("access")).toBe(
			"playable,preview,blocked"
		);
		expect(JSON.parse(String(calls[1]?.init.body)).playlist.tracks).toEqual([
			{ urn: "soundcloud:tracks:1" },
			{ urn: "soundcloud:tracks:2" },
		]);
	});

	it("refuses to rewrite a playlist whose tracks are not all returned", async () => {
		const { impl, calls } = stubFetch([
			json({ id: 7, track_count: 2, tracks: [{ id: 1, urn: "soundcloud:tracks:1" }] }),
		]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.addTracksToPlaylist(7, [2])).rejects.toThrow("hides some tracks");
		expect(calls).toHaveLength(1);
	});

	it("refuses to rewrite a playlist with a track it cannot identify", async () => {
		const { impl, calls } = stubFetch([
			json({ id: 7, tracks: [{ id: 1, urn: "soundcloud:tracks:1" }, { title: "no id" }] }),
		]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.removeTrackFromPlaylist(7, 1)).rejects.toThrow("hides some tracks");
		expect(calls).toHaveLength(1);
	});

	it("rejects a response whose fields have the wrong type", async () => {
		const { impl } = stubFetch([json({ id: 7, tracks: "not a list" })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.getPlaylist(7)).rejects.toMatchObject({ status: 502 });
	});

	it("removes one track from a playlist and keeps the rest", async () => {
		const { impl, calls } = stubFetch([
			json({
				id: 7,
				track_count: 2,
				tracks: [
					{ id: 1, urn: "soundcloud:tracks:1" },
					{ id: 2, urn: "soundcloud:tracks:2" },
				],
			}),
			json({ id: 7 }),
		]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.removeTrackFromPlaylist(7, 1);

		expect(JSON.parse(String(calls[1]?.init.body)).playlist.tracks).toEqual([
			{ urn: "soundcloud:tracks:2" },
		]);
	});

	it("returns undefined for the empty bodies that writes come back with", async () => {
		const { impl } = stubFetch([new Response(null, { status: 204 }), new Response("")]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.likeTrack(1)).resolves.toBeUndefined();
		await expect(client.unlikeTrack(1)).resolves.toBeUndefined();
	});
});
