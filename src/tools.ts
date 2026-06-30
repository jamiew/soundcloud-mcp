import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SoundCloudAPI } from "./api.js";
import { SoundCloudTrack, SoundCloudPlaylist } from "./types.js";
import {
  loginWithBrowser,
  hasUserToken,
  signOut,
  getValidAccessToken,
} from "./oauth.js";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string; description?: string };

type ToolResult = {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// Annotation presets (https://modelcontextprotocol.io/specification — tool annotations).
// openWorldHint is true everywhere since every tool talks to the external SoundCloud API.
const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

// Wraps return data: text block (always, for back-compat) + structuredContent for
// objects + any extra content blocks (e.g. resource links).
function ok(data: unknown, extra: ContentBlock[] = []): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const res: ToolResult = { content: [{ type: "text", text }, ...extra] };
  if (data && typeof data === "object") {
    res.structuredContent = Array.isArray(data) ? { items: data } : (data as Record<string, unknown>);
  }
  return res;
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// Runs a handler, returning data on success or a clean error. `extra` can derive
// extra content blocks (resource links) from the result.
async function run(
  fn: () => Promise<unknown>,
  extra?: (data: any) => ContentBlock[]
): Promise<ToolResult> {
  try {
    const data = await fn();
    return ok(data, extra?.(data) ?? []);
  } catch (error) {
    return fail(error);
  }
}

// Surface a track's permalink + artwork as links the client can render/fetch.
function trackLinks(track?: SoundCloudTrack): ContentBlock[] {
  if (!track) return [];
  const links: ContentBlock[] = [];
  if (track.permalink_url) {
    links.push({
      type: "resource_link",
      uri: track.permalink_url,
      name: track.title ?? "track",
      mimeType: "text/html",
      description: track.user?.username ? `by ${track.user.username}` : undefined,
    });
  }
  if (track.artwork_url) {
    links.push({ type: "resource_link", uri: track.artwork_url, name: `${track.title ?? "track"} — artwork`, mimeType: "image/jpeg" });
  }
  return links;
}

function playlistLinks(playlist?: SoundCloudPlaylist): ContentBlock[] {
  if (!playlist?.permalink_url) return [];
  return [{ type: "resource_link", uri: playlist.permalink_url, name: playlist.title ?? "playlist", mimeType: "text/html" }];
}

// Registers every tool, prompt, and resource on the given server. Kept separate
// from the transport so a future remote (HTTP) entrypoint can reuse it.
export function registerAll(server: McpServer, api: SoundCloudAPI): void {
  // --- Auth ---
  server.registerTool(
    "connect_soundcloud",
    {
      title: "Connect SoundCloud",
      description: "Log in to SoundCloud: opens a browser for OAuth and stores the token for future sessions",
      annotations: { title: "Connect SoundCloud", ...WRITE },
    },
    async () =>
      run(async () => {
        const { token } = await loginWithBrowser();
        const me = await api.getCurrentUser();
        return `Connected as ${me.username} (id ${me.id}). Token expires in ${token.expires_in}s and will auto-refresh.`;
      })
  );

  server.registerTool(
    "auth_status",
    { title: "Auth status", description: "Check whether a SoundCloud user is logged in", annotations: { title: "Auth status", ...READ } },
    async () =>
      run(async () => {
        if (!hasUserToken()) return "Not logged in. Use connect_soundcloud (public search still works).";
        await getValidAccessToken();
        const me = await api.getCurrentUser();
        return `Logged in as ${me.username} (id ${me.id}).`;
      })
  );

  server.registerTool(
    "sign_out",
    { title: "Sign out", description: "Sign out and forget the stored SoundCloud token", annotations: { title: "Sign out", ...DESTRUCTIVE } },
    async () =>
      run(async () => {
        const token = await getValidAccessToken();
        await signOut(token);
        const { clearTokens } = await import("./tokenStore.js");
        clearTokens();
        return "Signed out.";
      })
  );

  // --- Discovery / search ---
  server.registerTool(
    "search_tracks",
    {
      title: "Search tracks",
      description: "Search for tracks with optional filters",
      inputSchema: {
        query: z.string(),
        limit: z.number().min(1).max(200).optional(),
        genres: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        bpmFrom: z.number().optional(),
        bpmTo: z.number().optional(),
        durationFrom: z.number().optional(),
        durationTo: z.number().optional(),
        access: z.array(z.enum(["playable", "preview", "blocked"])).optional(),
      },
      annotations: { title: "Search tracks", ...READ },
    },
    async ({ query, limit, ...filters }) => run(() => api.searchTracks(query, limit, filters))
  );

  server.registerTool(
    "search_playlists",
    { title: "Search playlists", description: "Search for playlists by keyword", inputSchema: { query: z.string(), limit: z.number().min(1).max(200).optional() }, annotations: { title: "Search playlists", ...READ } },
    async ({ query, limit }) => run(() => api.searchPlaylists(query, limit))
  );

  server.registerTool(
    "search_users",
    { title: "Search users", description: "Search for users by keyword", inputSchema: { query: z.string(), limit: z.number().min(1).max(200).optional() }, annotations: { title: "Search users", ...READ } },
    async ({ query, limit }) => run(() => api.searchUsers(query, limit))
  );

  server.registerTool(
    "get_track",
    { title: "Get track", description: "Get information about a specific track", inputSchema: { trackId: z.number().min(1) }, annotations: { title: "Get track", ...READ } },
    async ({ trackId }) => run(() => api.getTrack(trackId), trackLinks)
  );

  server.registerTool(
    "get_user",
    { title: "Get user", description: "Get a user's public profile by ID", inputSchema: { userId: z.number().min(1) }, annotations: { title: "Get user", ...READ } },
    async ({ userId }) => run(() => api.getUser(userId))
  );

  server.registerTool(
    "get_playlist",
    { title: "Get playlist", description: "Get information about a specific playlist", inputSchema: { playlistId: z.number().min(1) }, annotations: { title: "Get playlist", ...READ } },
    async ({ playlistId }) => run(() => api.getPlaylist(playlistId), playlistLinks)
  );

  server.registerTool(
    "get_related_tracks",
    { title: "Get related tracks", description: "Get tracks related to a specific track", inputSchema: { trackId: z.number().min(1), limit: z.number().min(1).max(200).optional() }, annotations: { title: "Get related tracks", ...READ } },
    async ({ trackId, limit }) => run(() => api.getRelatedTracks(trackId, limit))
  );

  server.registerTool(
    "get_comments",
    { title: "Get track comments", description: "Get comments for a track", inputSchema: { trackId: z.number().min(1), limit: z.number().min(1).max(200).optional() }, annotations: { title: "Get track comments", ...READ } },
    async ({ trackId, limit }) => run(() => api.getTrackComments(trackId, limit))
  );

  // --- Me / library (requires login) ---
  server.registerTool(
    "get_profile",
    { title: "Get my profile", description: "Get the logged-in user's SoundCloud profile", annotations: { title: "Get my profile", ...READ } },
    async () => run(() => api.getCurrentUser())
  );

  server.registerTool(
    "get_likes",
    { title: "Get my likes", description: "Get the logged-in user's liked tracks", inputSchema: { limit: z.number().min(1).max(200).optional().default(50), nextPage: z.string().optional() }, annotations: { title: "Get my likes", ...READ } },
    async ({ limit, nextPage }) => run(() => (nextPage ? api.getNextPage(nextPage) : api.getUserLikes(limit)))
  );

  server.registerTool(
    "get_playlists",
    { title: "Get my playlists", description: "Get the logged-in user's playlists", inputSchema: { limit: z.number().min(1).max(200).optional().default(50), nextPage: z.string().optional() }, annotations: { title: "Get my playlists", ...READ } },
    async ({ limit, nextPage }) => run(() => (nextPage ? api.getNextPage(nextPage) : api.getUserPlaylists(limit)))
  );

  server.registerTool(
    "get_recommended_tracks",
    { title: "Get recommendations", description: "Get personalized track recommendations", inputSchema: { limit: z.number().min(1).max(200).optional() }, annotations: { title: "Get recommendations", ...READ } },
    async ({ limit }) => run(() => api.getRecommendedTracks(limit))
  );

  // --- Social writes ---
  server.registerTool(
    "like_track",
    { title: "Like track", description: "Like a track", inputSchema: { trackId: z.number().min(1) }, annotations: { title: "Like track", ...WRITE, idempotentHint: true } },
    async ({ trackId }) =>
      run(async () => {
        await api.likeTrack(trackId);
        return `Liked track ${trackId}.`;
      })
  );

  server.registerTool(
    "unlike_track",
    { title: "Unlike track", description: "Unlike a track", inputSchema: { trackId: z.number().min(1) }, annotations: { title: "Unlike track", ...WRITE, idempotentHint: true } },
    async ({ trackId }) =>
      run(async () => {
        await api.unlikeTrack(trackId);
        return `Unliked track ${trackId}.`;
      })
  );

  server.registerTool(
    "follow_user",
    { title: "Follow user", description: "Follow a user", inputSchema: { userId: z.number().min(1) }, annotations: { title: "Follow user", ...WRITE, idempotentHint: true } },
    async ({ userId }) =>
      run(async () => {
        await api.followUser(userId);
        return `Followed user ${userId}.`;
      })
  );

  server.registerTool(
    "unfollow_user",
    { title: "Unfollow user", description: "Unfollow a user", inputSchema: { userId: z.number().min(1) }, annotations: { title: "Unfollow user", ...WRITE, idempotentHint: true } },
    async ({ userId }) =>
      run(async () => {
        await api.unfollowUser(userId);
        return `Unfollowed user ${userId}.`;
      })
  );

  server.registerTool(
    "add_comment",
    { title: "Add comment", description: "Add a comment to a track", inputSchema: { trackId: z.number().min(1), body: z.string(), timestamp: z.number().optional() }, annotations: { title: "Add comment", ...WRITE } },
    async ({ trackId, body, timestamp }) =>
      run(async () => {
        await api.addComment(trackId, body, timestamp);
        return `Commented on track ${trackId}.`;
      })
  );

  // --- Playlist writes ---
  server.registerTool(
    "create_playlist",
    {
      title: "Create playlist",
      description: "Create a new playlist, optionally with tracks",
      inputSchema: { title: z.string(), description: z.string().optional(), sharing: z.enum(["public", "private"]).optional(), trackIds: z.array(z.number()).optional() },
      annotations: { title: "Create playlist", ...WRITE },
    },
    async ({ title, description, sharing, trackIds }) =>
      run(() => api.createPlaylist(title, { description, sharing, trackIds }), playlistLinks)
  );

  server.registerTool(
    "update_playlist",
    {
      title: "Update playlist",
      description: "Rename, redescribe, change sharing, or replace the tracklist of a playlist",
      inputSchema: { playlistId: z.number().min(1), title: z.string().optional(), description: z.string().optional(), sharing: z.enum(["public", "private"]).optional(), trackIds: z.array(z.number()).optional() },
      annotations: { title: "Update playlist", ...DESTRUCTIVE },
    },
    async ({ playlistId, ...updates }) => run(() => api.updatePlaylist(playlistId, updates), playlistLinks)
  );

  server.registerTool(
    "add_tracks_to_playlist",
    { title: "Add tracks to playlist", description: "Append tracks to an existing playlist", inputSchema: { playlistId: z.number().min(1), trackIds: z.array(z.number()).min(1) }, annotations: { title: "Add tracks to playlist", ...WRITE } },
    async ({ playlistId, trackIds }) => run(() => api.addTracksToPlaylist(playlistId, trackIds), playlistLinks)
  );

  server.registerTool(
    "remove_track_from_playlist",
    { title: "Remove track from playlist", description: "Remove a track from a playlist", inputSchema: { playlistId: z.number().min(1), trackId: z.number().min(1) }, annotations: { title: "Remove track from playlist", ...DESTRUCTIVE } },
    async ({ playlistId, trackId }) => run(() => api.removeTrackFromPlaylist(playlistId, trackId), playlistLinks)
  );

  server.registerTool(
    "delete_playlist",
    { title: "Delete playlist", description: "Delete a playlist permanently", inputSchema: { playlistId: z.number().min(1) }, annotations: { title: "Delete playlist", ...DESTRUCTIVE } },
    async ({ playlistId }) =>
      run(async () => {
        await api.deletePlaylist(playlistId);
        return `Deleted playlist ${playlistId}.`;
      })
  );

  // --- Messaging ---
  server.registerTool(
    "get_conversations",
    { title: "Get conversations", description: "Get your direct message conversations", inputSchema: { limit: z.number().min(1).max(200).optional() }, annotations: { title: "Get conversations", ...READ } },
    async ({ limit }) => run(() => api.getConversations(limit))
  );

  server.registerTool(
    "get_conversation",
    { title: "Get conversation", description: "Get details of a specific conversation", inputSchema: { conversationId: z.number().min(1) }, annotations: { title: "Get conversation", ...READ } },
    async ({ conversationId }) => run(() => api.getConversation(conversationId))
  );

  server.registerTool(
    "get_messages",
    { title: "Get messages", description: "Get messages from a conversation", inputSchema: { conversationId: z.number().min(1), limit: z.number().min(1).max(200).optional() }, annotations: { title: "Get messages", ...READ } },
    async ({ conversationId, limit }) => run(() => api.getMessages(conversationId, limit))
  );

  server.registerTool(
    "send_message",
    { title: "Send message", description: "Send a message in a conversation", inputSchema: { conversationId: z.number().min(1), message: z.string() }, annotations: { title: "Send message", ...WRITE } },
    async ({ conversationId, message }) => run(() => api.sendMessage(conversationId, message))
  );

  server.registerTool(
    "start_conversation",
    { title: "Start conversation", description: "Start a new conversation with a user", inputSchema: { userId: z.number().min(1), message: z.string() }, annotations: { title: "Start conversation", ...WRITE } },
    async ({ userId, message }) => run(() => api.startConversation(userId, message))
  );

  server.registerTool(
    "mark_conversation_read",
    { title: "Mark conversation read", description: "Mark a conversation as read", inputSchema: { conversationId: z.number().min(1) }, annotations: { title: "Mark conversation read", ...WRITE, idempotentHint: true } },
    async ({ conversationId }) =>
      run(async () => {
        await api.markConversationAsRead(conversationId);
        return `Marked conversation ${conversationId} as read.`;
      })
  );

  registerPrompts(server, api);
  registerResources(server, api);
}

function registerPrompts(server: McpServer, api: SoundCloudAPI): void {
  server.registerPrompt(
    "analyze_music_taste",
    { title: "Analyze music taste", description: "Analyze a user's music taste based on their liked tracks" },
    async () => {
      const likes = await api.getUserLikes(50);
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Please analyze my music taste based on these tracks I've liked:\n\n${JSON.stringify(likes, null, 2)}\n\nProvide insights about genres, artists, and musical elements I tend to prefer.` },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "discover_similar_tracks",
    { title: "Discover similar tracks", description: "Find tracks similar to a specific track", argsSchema: { trackId: z.string() } },
    async ({ trackId }) => {
      const id = parseInt(trackId, 10);
      if (isNaN(id)) throw new Error("Invalid track ID");
      const track = await api.getTrack(id);
      const related = await api.getRelatedTracks(id, 10);
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Here's a track I like:\n\n${JSON.stringify(track, null, 2)}\n\nAnd here are some related tracks:\n\n${JSON.stringify(related, null, 2)}\n\nExplain what they have in common and which I might enjoy most.` },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "discover_new_music",
    { title: "Discover new music", description: "Get personalized music discovery recommendations", argsSchema: { genres: z.string().optional(), mood: z.string().optional() } },
    async ({ genres, mood }) => {
      const likes = await api.getUserLikes(20);
      const seed = genres?.split(",")[0]?.trim();
      const search = seed ? await api.searchTracks(seed, 20) : { collection: [] };
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: `I'm looking for new music${genres ? ` in these genres: ${genres}` : ""}${mood ? ` with a ${mood} mood` : ""}.\n\nTracks I've liked:\n${JSON.stringify(likes, null, 2)}\n\nSome tracks matching "${seed ?? ""}":\n${JSON.stringify(search, null, 2)}\n\nSuggest new tracks, artists, or genres I might enjoy and explain why.` },
          },
        ],
      };
    }
  );
}

function registerResources(server: McpServer, api: SoundCloudAPI): void {
  server.registerResource(
    "my-profile",
    "soundcloud://me/profile",
    { title: "My profile", description: "The logged-in user's profile", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api.getCurrentUser(), null, 2) }] })
  );

  server.registerResource(
    "my-playlists",
    "soundcloud://me/playlists",
    { title: "My playlists", description: "The logged-in user's playlists", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api.getUserPlaylists(), null, 2) }] })
  );

  server.registerResource(
    "my-likes",
    "soundcloud://me/likes",
    { title: "My likes", description: "The logged-in user's liked tracks", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api.getUserLikes(), null, 2) }] })
  );
}
