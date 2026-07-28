// Live end-to-end check of the stdio server against the real SoundCloud API.
// Usage: node tmp/verify.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["--env-file-if-exists=.env", "build/index.js"],
  cwd: "/Users/jamie/dev/soundcloud-mcp",
});
const client = new Client({ name: "verify", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tools registered\n`);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  const isErr = r.isError || text.startsWith("Error:");
  return { ok: !isErr, text, structured: r.structuredContent };
};

const first = (r) => r.structured?.collection?.[0] ?? r.structured?.items?.[0];
const results = [];
const check = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` — ${note}` : ""}`);
};

// Discovery
const search = await call("search_tracks", { query: "aphex twin", limit: 3 });
const track = first(search);
check("search_tracks", search.ok && !!track, track?.title);

const resolved = await call("resolve_url", { url: "https://soundcloud.com/four-tet" });
check("resolve_url", resolved.ok, resolved.structured?.username ?? resolved.text.slice(0, 60));

const users = await call("search_users", { query: "four tet", limit: 1 });
const user = first(users);
check("search_users", users.ok && !!user, user?.username);

if (track?.urn) {
  const byUrn = await call("get_track", { trackId: track.urn });
  check("get_track (URN)", byUrn.ok && byUrn.structured?.id === track.id, track.urn);
  const byNum = await call("get_track", { trackId: track.id });
  check("get_track (numeric)", byNum.ok && byNum.structured?.id === track.id, String(track.id));

  const related = await call("get_related_tracks", { trackId: track.urn, limit: 3 });
  check("get_related_tracks", related.ok, first(related)?.title);

  const streams = await call("get_stream_url", { trackId: track.urn });
  check("get_stream_url", streams.ok, Object.keys(streams.structured ?? {}).join(", ").slice(0, 60));

  const comments = await call("get_comments", { trackId: track.urn, limit: 2 });
  check("get_comments", comments.ok);
}

if (user?.urn) {
  const userTracks = await call("get_user_tracks", { userId: user.urn, limit: 3 });
  check("get_user_tracks", userTracks.ok, first(userTracks)?.title);

  const userLikes = await call("get_user_likes", { userId: user.urn, limit: 3 });
  check("get_user_likes", userLikes.ok, first(userLikes)?.title);

  const relatedArtists = await call("get_related_artists", { userId: user.urn, limit: 3 });
  check("get_related_artists", relatedArtists.ok, first(relatedArtists)?.username);
}

// Library
const profile = await call("get_profile");
check("get_profile", profile.ok, profile.structured?.username);

const likes = await call("get_likes", { limit: 3 });
check("get_likes", likes.ok, first(likes)?.track?.title ?? first(likes)?.title);

check("get_playlists", (await call("get_playlists", { limit: 3 })).ok);
check("get_my_tracks", (await call("get_my_tracks", { limit: 3 })).ok);

const followings = await call("get_my_followings", { limit: 3 });
check("get_my_followings", followings.ok, first(followings)?.username);

const feed = await call("get_feed", { limit: 3 });
check("get_feed", feed.ok, first(feed)?.title ?? feed.text.slice(0, 60));

const recent = await call("get_recently_played", { limit: 3 });
check("get_recently_played", recent.ok, first(recent)?.title ?? recent.text.slice(0, 60));

// Pagination
if (likes.structured?.next_href) {
  const page2 = await call("next_page", { nextHref: likes.structured.next_href });
  check("next_page", page2.ok, `${page2.structured?.collection?.length ?? 0} items`);
}

// Playlist round-trip: create with a big track id, read back, delete.
const bigTrack = (await call("search_tracks", { query: "boards of canada", limit: 1 }));
const seed = first(bigTrack);
if (seed) {
  const created = await call("create_playlist", {
    title: "mcp verify (temp)",
    sharing: "private",
    trackIds: [seed.urn],
  });
  const pid = created.structured?.urn ?? created.structured?.id;
  check("create_playlist", created.ok && !!pid, `id ${seed.id}`);
  if (pid) {
    const tracks = await call("get_playlist_tracks", { playlistId: pid, limit: 5 });
    check("get_playlist_tracks", tracks.ok, `${tracks.structured?.collection?.length ?? 0} tracks`);
    const del = await call("delete_playlist", { playlistId: pid });
    check("delete_playlist (cleanup)", del.ok);
  }
}

// Protocol surfaces beyond tools. Templates are read by URI, so this is the only
// thing that proves they resolve.
const info = client.getServerVersion();
check("server metadata", !!(info.title && info.description && info.icons?.length), info.title);
check("instructions", (client.getInstructions()?.length ?? 0) > 100);

const { resources } = await client.listResources();
check("list resources", resources.length === 3, resources.map((r) => r.uri).join(", "));

const { resourceTemplates } = await client.listResourceTemplates();
check("list resource templates", resourceTemplates.length === 3);

if (track?.id) {
  const read = await client.readResource({ uri: `soundcloud://tracks/${track.id}` });
  const title = JSON.parse(read.contents[0].text)?.title;
  check("read track template", !!title, title);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log("failed:", failed.map((f) => f.name).join(", "));
await client.close();
