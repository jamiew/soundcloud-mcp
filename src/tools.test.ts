import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { SoundCloudClient } from "./client.js";
import { registerAuthTools } from "./stdio/authTools.js";
import { registerTools } from "./tools.js";

type Upstream = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Connects an SDK client in process. `upstream` answers every SoundCloud request. */
async function connect({
	writes = true,
	auth = false,
	upstream = () => new Response("{}"),
}: {
	writes?: boolean;
	auth?: boolean;
	upstream?: Upstream;
} = {}) {
	const token = async () => "token";
	const sc = new SoundCloudClient(
		{ getAccessToken: token, refreshAccessToken: token },
		undefined,
		async (url, init) => upstream(String(url), init ?? {})
	);
	const server = new McpServer({ name: "test", version: "0" });
	registerTools(server, sc, { writes });
	if (auth) registerAuthTools(server, sc);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(clientTransport);
	return client;
}

async function listTools(options: { writes: boolean; auth: boolean }) {
	const client = await connect(options);
	const { tools } = await client.listTools();
	await client.close();
	return tools;
}

describe("tool metadata", async () => {
	const tools = await listTools({ writes: true, auth: true });

	it.each(tools.map((tool) => [tool.name, tool]))("%s has a title and description", (_, tool) => {
		expect(tool.title).toBeTruthy();
		expect(tool.description).toBeTruthy();
	});

	// Clients use these hints to decide what needs confirmation. A missing
	// destructiveHint defaults to true, so an unmarked like looks like a delete.
	it.each(tools.map((tool) => [tool.name, tool]))("%s declares its behavior", (_, tool) => {
		const hints = tool.annotations ?? {};
		expect(hints.readOnlyHint).toBeTypeOf("boolean");
		expect(hints.openWorldHint).toBe(true);
		if (!hints.readOnlyHint) expect(hints.destructiveHint).toBeTypeOf("boolean");
	});

	it("registers only read-only tools when writes are off", async () => {
		const readOnly = await listTools({ writes: false, auth: false });
		const writable = readOnly.filter((tool) => !tool.annotations?.readOnlyHint);
		expect(writable.map((tool) => tool.name)).toEqual([]);
	});
});

describe("cancellation", () => {
	it("aborts the SoundCloud request when the client cancels the tool call", async () => {
		const upstreamSignal = Promise.withResolvers<AbortSignal>();
		const client = await connect({
			upstream: (_url, init) => {
				if (init.signal) upstreamSignal.resolve(init.signal);
				return Promise.withResolvers<Response>().promise;
			},
		});
		const cancel = new AbortController();
		const call = client.callTool({ name: "get_profile", arguments: {} }, { signal: cancel.signal });
		const signal = await upstreamSignal.promise;

		cancel.abort();
		await expect(call).rejects.toThrow();
		await expect.poll(() => signal.aborted).toBe(true);
		await client.close();
	});
});

// Shaped like real API responses: each entity carries far more than the model needs.
const uploader = {
	id: 7,
	urn: "soundcloud:users:7",
	kind: "user",
	username: "aphextwin",
	permalink: "richarddjames",
	permalink_url: "https://soundcloud.com/richarddjames",
	description: "A long profile text.",
	followers_count: 184768,
	subscriptions: [{ product: { id: "free" } }],
};
const track = {
	id: 1,
	urn: "soundcloud:tracks:1",
	kind: "track",
	title: "Xtal",
	description: "A long track description.",
	duration: 293799,
	access: "preview",
	permalink_url: "https://soundcloud.com/richarddjames/xtal",
	waveform_url: "https://wave.sndcdn.com/x.png",
	favoritings_count: 21374,
	user: uploader,
};
const json = (body: unknown) => new Response(JSON.stringify(body));

async function call(name: string, args: Record<string, unknown>, body: unknown) {
	const client = await connect({ upstream: () => json(body) });
	const result = await client.callTool({ name, arguments: args });
	await client.close();
	return result;
}

describe("compact results", () => {
	it("trims tracks and names their uploader without the full profile", async () => {
		const result = await call("search_tracks", { query: "xtal" }, { collection: [track] });

		expect(result.structuredContent).toEqual({
			collection: [
				{
					id: 1,
					urn: "soundcloud:tracks:1",
					title: "Xtal",
					duration: 293799,
					access: "preview",
					permalink_url: "https://soundcloud.com/richarddjames/xtal",
					favoritings_count: 21374,
					user: {
						id: 7,
						urn: "soundcloud:users:7",
						username: "aphextwin",
						permalink_url: "https://soundcloud.com/richarddjames",
					},
				},
			],
		});
		const [text] = result.content as { type: string; text: string }[];
		expect(JSON.parse(text?.text ?? "")).toEqual(result.structuredContent);
	});

	it("returns every upstream field with verbose", async () => {
		const page = { collection: [track], next_href: null };
		const result = await call("search_tracks", { query: "xtal", verbose: true }, page);
		expect(result.structuredContent).toEqual(page);
	});

	it("trims a playlist's tracks and a user profile", async () => {
		const playlist = {
			id: 3,
			urn: "soundcloud:playlists:3",
			title: "Live",
			track_count: 1,
			tracks_uri: "https://api.soundcloud.com/playlists/3/tracks",
			user: uploader,
			tracks: [track],
		};
		const listed = await call("get_playlist", { playlistId: 3 }, playlist);
		expect(listed.structuredContent).toMatchObject({
			urn: "soundcloud:playlists:3",
			title: "Live",
			tracks: [{ urn: "soundcloud:tracks:1", title: "Xtal" }],
		});
		expect(listed.structuredContent).not.toHaveProperty("tracks_uri");
		expect(listed.structuredContent).not.toHaveProperty(["tracks", 0, "description"]);

		const profile = await call("get_user", { userId: 7 }, uploader);
		expect(profile.structuredContent).toMatchObject({ permalink: "richarddjames" });
		expect(profile.structuredContent).not.toHaveProperty("description");
		expect(profile.structuredContent).not.toHaveProperty("subscriptions");
	});

	it("lists playlists by track_count without their tracklists", async () => {
		const playlist = {
			urn: "soundcloud:playlists:3",
			title: "Live",
			track_count: 1,
			tracks: [track],
		};
		const station = { ...playlist, urn: "soundcloud:system-playlists:track-stations:1" };
		const feed = { collection: [{ type: "playlist", playlist }] };
		const page = { collection: [playlist, station] };

		const listed = await call("get_my_playlists", {}, page);
		expect(listed.structuredContent).toEqual({
			collection: [
				{ urn: "soundcloud:playlists:3", title: "Live", track_count: 1 },
				{ urn: "soundcloud:system-playlists:track-stations:1", title: "Live", track_count: 1 },
			],
		});
		const inFeed = await call("get_feed", {}, feed);
		expect(inFeed.structuredContent).not.toHaveProperty(["collection", 0, "playlist", "tracks"]);
		const verbose = await call("get_my_playlists", { verbose: true }, page);
		expect(verbose.structuredContent).toEqual(page);
	});

	it("drops utm tracking parameters from permalinks and keeps the rest", async () => {
		const tracking = "utm_medium=api&utm_campaign=social_sharing&utm_source=id_316169";
		const linked = {
			...track,
			permalink_url: `https://soundcloud.com/a/b/s-SECRET?si=keep&${tracking}`,
			user: { ...uploader, permalink_url: `https://soundcloud.com/a?${tracking}` },
		};

		const compactResult = await call("get_track", { trackId: 1 }, linked);
		expect(compactResult.structuredContent).toMatchObject({
			permalink_url: "https://soundcloud.com/a/b/s-SECRET?si=keep",
			user: { permalink_url: "https://soundcloud.com/a" },
		});
		const verbose = await call("get_track", { trackId: 1, verbose: true }, linked);
		expect(verbose.structuredContent).toMatchObject({ permalink_url: linked.permalink_url });
	});

	// next_page, resolve_url and the feed hold whatever the endpoint returns,
	// so entities are recognized by URN wherever they sit.
	it("recognizes entities by URN inside unchecked results and wrappers", async () => {
		const feed = { collection: [{ type: "track:repost", created_at: "2026", track }] };
		const result = await call(
			"next_page",
			{ nextHref: "https://api.soundcloud.com/me/feed?cursor=x" },
			feed
		);
		expect(result.structuredContent).toMatchObject({
			collection: [{ type: "track:repost", created_at: "2026", track: { title: "Xtal" } }],
		});
		expect(JSON.stringify(result.structuredContent)).not.toContain("description");
	});
});

// Resources and prompts fail with protocol errors, not tool results, but they
// must still keep upstream details out of what the client sees.
describe("resource and prompt errors", () => {
	it("reports a missing track resource as not found", async () => {
		let requests = 0;
		const client = await connect({
			upstream: () => {
				requests += 1;
				return new Response("{}", { status: 404 });
			},
		});
		await expect(client.readResource({ uri: "soundcloud://tracks/1" })).rejects.toMatchObject({
			data: { uri: "soundcloud://tracks/1" },
		});
		expect(requests).toBe(1);
		await client.close();
	});

	it("keeps an unreadable upstream body out of prompt errors", async () => {
		const client = await connect({ upstream: () => new Response("<html>upstream page") });
		const error = await client.getPrompt({ name: "analyze_music_taste" }).catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error.message).not.toContain("upstream page");
		await client.close();
	});
});
