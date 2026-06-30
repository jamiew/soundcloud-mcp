import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SoundCloudAPI } from "./api.js";
import {
  loginWithBrowser,
  hasUserToken,
  signOut,
  getValidAccessToken,
} from "./oauth.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// Wraps a handler so every tool returns data on success or a clean error string.
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

// Registers every tool, prompt, and resource on the given server. Kept separate
// from the transport so a future remote (HTTP) entrypoint can reuse it.
export function registerAll(server: McpServer, api: SoundCloudAPI): void {
  // --- Auth ---
  server.tool(
    "connect_soundcloud",
    "Log in to SoundCloud: opens a browser for OAuth and stores the token for future sessions",
    {},
    async () =>
      run(async () => {
        const { token } = await loginWithBrowser();
        const me = await api.getCurrentUser();
        return `Connected as ${me.username} (id ${me.id}). Token expires in ${token.expires_in}s and will auto-refresh.`;
      })
  );

  server.tool("auth_status", "Check whether a SoundCloud user is logged in", {}, async () =>
    run(async () => {
      if (!hasUserToken()) return "Not logged in. Use connect_soundcloud (public search still works).";
      await getValidAccessToken();
      const me = await api.getCurrentUser();
      return `Logged in as ${me.username} (id ${me.id}).`;
    })
  );

  server.tool("sign_out", "Sign out and forget the stored SoundCloud token", {}, async () =>
    run(async () => {
      const token = await getValidAccessToken();
      await signOut(token);
      const { clearTokens } = await import("./tokenStore.js");
      clearTokens();
      return "Signed out.";
    })
  );

  // --- Discovery / search ---
  server.tool(
    "search_tracks",
    "Search for tracks with optional filters",
    {
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
    async ({ query, limit, ...filters }) => run(() => api.searchTracks(query, limit, filters))
  );

  server.tool(
    "search_playlists",
    "Search for playlists by keyword",
    { query: z.string(), limit: z.number().min(1).max(200).optional() },
    async ({ query, limit }) => run(() => api.searchPlaylists(query, limit))
  );

  server.tool(
    "search_users",
    "Search for users by keyword",
    { query: z.string(), limit: z.number().min(1).max(200).optional() },
    async ({ query, limit }) => run(() => api.searchUsers(query, limit))
  );

  server.tool(
    "get_track",
    "Get information about a specific track",
    { trackId: z.number().min(1) },
    async ({ trackId }) => run(() => api.getTrack(trackId))
  );

  server.tool(
    "get_user",
    "Get a user's public profile by ID",
    { userId: z.number().min(1) },
    async ({ userId }) => run(() => api.getUser(userId))
  );

  server.tool(
    "get_playlist",
    "Get information about a specific playlist",
    { playlistId: z.number().min(1) },
    async ({ playlistId }) => run(() => api.getPlaylist(playlistId))
  );

  server.tool(
    "get_related_tracks",
    "Get tracks related to a specific track",
    { trackId: z.number().min(1), limit: z.number().min(1).max(200).optional() },
    async ({ trackId, limit }) => run(() => api.getRelatedTracks(trackId, limit))
  );

  server.tool(
    "get_comments",
    "Get comments for a track",
    { trackId: z.number().min(1), limit: z.number().min(1).max(200).optional() },
    async ({ trackId, limit }) => run(() => api.getTrackComments(trackId, limit))
  );

  // --- Me / library (requires login) ---
  server.tool("get_profile", "Get the logged-in user's SoundCloud profile", {}, async () =>
    run(() => api.getCurrentUser())
  );

  server.tool(
    "get_likes",
    "Get the logged-in user's liked tracks",
    { limit: z.number().min(1).max(200).optional().default(50), nextPage: z.string().optional() },
    async ({ limit, nextPage }) => run(() => (nextPage ? api.getNextPage(nextPage) : api.getUserLikes(limit)))
  );

  server.tool(
    "get_playlists",
    "Get the logged-in user's playlists",
    { limit: z.number().min(1).max(200).optional().default(50), nextPage: z.string().optional() },
    async ({ limit, nextPage }) =>
      run(() => (nextPage ? api.getNextPage(nextPage) : api.getUserPlaylists(limit)))
  );

  server.tool(
    "get_recommended_tracks",
    "Get personalized track recommendations",
    { limit: z.number().min(1).max(200).optional() },
    async ({ limit }) => run(() => api.getRecommendedTracks(limit))
  );

  // --- Social writes ---
  server.tool("like_track", "Like a track", { trackId: z.number().min(1) }, async ({ trackId }) =>
    run(async () => {
      await api.likeTrack(trackId);
      return `Liked track ${trackId}.`;
    })
  );

  server.tool("unlike_track", "Unlike a track", { trackId: z.number().min(1) }, async ({ trackId }) =>
    run(async () => {
      await api.unlikeTrack(trackId);
      return `Unliked track ${trackId}.`;
    })
  );

  server.tool("follow_user", "Follow a user", { userId: z.number().min(1) }, async ({ userId }) =>
    run(async () => {
      await api.followUser(userId);
      return `Followed user ${userId}.`;
    })
  );

  server.tool("unfollow_user", "Unfollow a user", { userId: z.number().min(1) }, async ({ userId }) =>
    run(async () => {
      await api.unfollowUser(userId);
      return `Unfollowed user ${userId}.`;
    })
  );

  server.tool(
    "add_comment",
    "Add a comment to a track",
    { trackId: z.number().min(1), body: z.string(), timestamp: z.number().optional() },
    async ({ trackId, body, timestamp }) =>
      run(async () => {
        await api.addComment(trackId, body, timestamp);
        return `Commented on track ${trackId}.`;
      })
  );

  // --- Playlist writes ---
  server.tool(
    "create_playlist",
    "Create a new playlist, optionally with tracks",
    {
      title: z.string(),
      description: z.string().optional(),
      sharing: z.enum(["public", "private"]).optional(),
      trackIds: z.array(z.number()).optional(),
    },
    async ({ title, description, sharing, trackIds }) =>
      run(() => api.createPlaylist(title, { description, sharing, trackIds }))
  );

  server.tool(
    "update_playlist",
    "Rename, redescribe, change sharing, or replace the tracklist of a playlist",
    {
      playlistId: z.number().min(1),
      title: z.string().optional(),
      description: z.string().optional(),
      sharing: z.enum(["public", "private"]).optional(),
      trackIds: z.array(z.number()).optional(),
    },
    async ({ playlistId, ...updates }) => run(() => api.updatePlaylist(playlistId, updates))
  );

  server.tool(
    "add_tracks_to_playlist",
    "Append tracks to an existing playlist",
    { playlistId: z.number().min(1), trackIds: z.array(z.number()).min(1) },
    async ({ playlistId, trackIds }) => run(() => api.addTracksToPlaylist(playlistId, trackIds))
  );

  server.tool(
    "remove_track_from_playlist",
    "Remove a track from a playlist",
    { playlistId: z.number().min(1), trackId: z.number().min(1) },
    async ({ playlistId, trackId }) => run(() => api.removeTrackFromPlaylist(playlistId, trackId))
  );

  server.tool(
    "delete_playlist",
    "Delete a playlist permanently",
    { playlistId: z.number().min(1) },
    async ({ playlistId }) =>
      run(async () => {
        await api.deletePlaylist(playlistId);
        return `Deleted playlist ${playlistId}.`;
      })
  );

  // --- Messaging ---
  server.tool(
    "get_conversations",
    "Get your direct message conversations",
    { limit: z.number().min(1).max(200).optional() },
    async ({ limit }) => run(() => api.getConversations(limit))
  );

  server.tool(
    "get_conversation",
    "Get details of a specific conversation",
    { conversationId: z.number().min(1) },
    async ({ conversationId }) => run(() => api.getConversation(conversationId))
  );

  server.tool(
    "get_messages",
    "Get messages from a conversation",
    { conversationId: z.number().min(1), limit: z.number().min(1).max(200).optional() },
    async ({ conversationId, limit }) => run(() => api.getMessages(conversationId, limit))
  );

  server.tool(
    "send_message",
    "Send a message in a conversation",
    { conversationId: z.number().min(1), message: z.string() },
    async ({ conversationId, message }) => run(() => api.sendMessage(conversationId, message))
  );

  server.tool(
    "start_conversation",
    "Start a new conversation with a user",
    { userId: z.number().min(1), message: z.string() },
    async ({ userId, message }) => run(() => api.startConversation(userId, message))
  );

  server.tool(
    "mark_conversation_read",
    "Mark a conversation as read",
    { conversationId: z.number().min(1) },
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
  server.prompt("analyze_music_taste", "Analyze a user's music taste based on their liked tracks", {}, async () => {
    const likes = await api.getUserLikes(50);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please analyze my music taste based on these tracks I've liked:\n\n${JSON.stringify(likes, null, 2)}\n\nProvide insights about genres, artists, and musical elements I tend to prefer.`,
          },
        },
      ],
    };
  });

  server.prompt(
    "discover_similar_tracks",
    "Find tracks similar to a specific track",
    { trackId: z.string() },
    async ({ trackId }) => {
      const id = parseInt(trackId, 10);
      if (isNaN(id)) throw new Error("Invalid track ID");
      const track = await api.getTrack(id);
      const related = await api.getRelatedTracks(id, 10);
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Here's a track I like:\n\n${JSON.stringify(track, null, 2)}\n\nAnd here are some related tracks:\n\n${JSON.stringify(related, null, 2)}\n\nExplain what they have in common and which I might enjoy most.`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "discover_new_music",
    "Get personalized music discovery recommendations",
    { genres: z.string().optional(), mood: z.string().optional() },
    async ({ genres, mood }) => {
      const likes = await api.getUserLikes(20);
      const seed = genres?.split(",")[0]?.trim();
      const search = seed ? await api.searchTracks(seed, 20) : { collection: [] };
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

function registerResources(server: McpServer, api: SoundCloudAPI): void {
  server.resource("my_profile", "soundcloud://me/profile", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api.getCurrentUser(), null, 2) }],
  }));

  server.resource("my_playlists", "soundcloud://me/playlists", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api.getUserPlaylists(), null, 2) }],
  }));

  server.resource("my_likes", "soundcloud://me/likes", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api.getUserLikes(), null, 2) }],
  }));
}
