import { describe, expect, it } from "vitest";
import { RateLimitedError, SoundCloudAuthError, SoundCloudClient, toUrn } from "./client.js";

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

	it("builds track paths from URNs", async () => {
		const { impl, calls } = stubFetch([json({ id: 3419282 })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.getTrack(3419282);

		expect(calls[0]?.url).toBe("https://api.soundcloud.com/tracks/soundcloud:tracks:3419282");
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

	it("prefers SoundCloud's own error message", async () => {
		const { impl } = stubFetch([json({ message: "Playlist not found" }, 404)]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await expect(client.getPlaylist(5)).rejects.toThrow("Playlist not found");
	});

	it("asks for cursor pagination on collection endpoints", async () => {
		const { impl, calls } = stubFetch([json({ collection: [] })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.getMyLikes(10);

		expect(calls[0]?.url).toContain("linked_partitioning=true");
		expect(calls[0]?.url).toContain("limit=10");
	});

	it("follows a next_href cursor as an absolute URL", async () => {
		const { impl, calls } = stubFetch([json({ collection: [] })]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.nextPage("https://api.soundcloud.com/me/likes/tracks?cursor=abc");

		expect(calls[0]?.url).toBe("https://api.soundcloud.com/me/likes/tracks?cursor=abc");
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
			json({ id: 7, tracks: [{ id: 1, urn: "soundcloud:tracks:1" }] }),
			json({ id: 7 }),
		]);
		const client = new SoundCloudClient(tokens().provider, undefined, impl);

		await client.addTracksToPlaylist(7, [2]);

		expect(JSON.parse(String(calls[1]?.init.body)).playlist.tracks).toEqual([
			{ urn: "soundcloud:tracks:1" },
			{ urn: "soundcloud:tracks:2" },
		]);
	});

	it("removes one track from a playlist and keeps the rest", async () => {
		const { impl, calls } = stubFetch([
			json({
				id: 7,
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
