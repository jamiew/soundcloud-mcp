#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SoundCloudAPI } from "./api.js";
import { SoundCloudOAuth } from "./oauth.js";
import { SoundCloudUser } from "./types.js";

// Environment validation
const requiredEnvVars = [
  "SOUNDCLOUD_CLIENT_ID",
  "SOUNDCLOUD_CLIENT_SECRET",
  "SOUNDCLOUD_REDIRECT_URI",
] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize OAuth manager
const oauth = new SoundCloudOAuth({
  clientId: process.env.SOUNDCLOUD_CLIENT_ID!,
  clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET!,
  redirectUri: process.env.SOUNDCLOUD_REDIRECT_URI!,
});

// Initialize SoundCloud API client with client credentials
let api: SoundCloudAPI;

// Create MCP server
const server = new McpServer({
  name: "soundcloud",
  version: "1.0.0",
});

// OAuth Tools
server.tool(
  "start-oauth-flow",
  "Start the OAuth authorization flow and get the authorization URL",
  {},
  async () => {
    try {
      const pkce = await oauth.generatePKCEChallenge();
      const authUrl = oauth.getAuthorizationUrl(pkce);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                authUrl,
                pkce,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error starting OAuth flow: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "exchange-oauth-code",
  "Exchange an authorization code for access and refresh tokens",
  {
    code: z.string(),
    codeVerifier: z.string(),
    state: z.string(),
  },
  async ({ code, codeVerifier, state }) => {
    try {
      const token = await oauth.exchangeCode(code, codeVerifier);
      // Update API client with new token
      api = new SoundCloudAPI(token.access_token);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(token, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error exchanging code: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get-client-credentials",
  "Get an access token using client credentials flow",
  {},
  async () => {
    try {
      const token = await oauth.getClientCredentialsToken();
      // Update API client with new token
      api = new SoundCloudAPI(token.access_token);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(token, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting client credentials token: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "refresh-token",
  "Refresh an access token using a refresh token",
  {
    refreshToken: z.string(),
  },
  async ({ refreshToken }) => {
    try {
      const token = await oauth.refreshToken(refreshToken);
      // Update API client with new token
      api = new SoundCloudAPI(token.access_token);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(token, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error refreshing token: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "sign-out",
  "Sign out and invalidate the current access token",
  {},
  async () => {
    try {
      if (!api) {
        throw new Error("No active session");
      }
      await oauth.signOut(api.getAccessToken());
      api = undefined!;
      return {
        content: [
          {
            type: "text",
            text: "Successfully signed out",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error signing out: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Prompts
server.prompt(
  "analyze-music-taste",
  "Analyze a user's music taste based on their liked tracks",
  {},
  async () => {
    const likes = await api.getUserLikes(50);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please analyze my music taste based on these tracks I've liked:\n\n${JSON.stringify(
              likes,
              null,
              2
            )}\n\nProvide insights about genres, artists, and musical elements I tend to prefer.`,
          },
        },
      ],
    };
  }
);

server.prompt(
  "discover-similar-tracks",
  "Find tracks similar to a specific track",
  {
    trackId: z.string(),
  },
  async ({ trackId }) => {
    const trackIdNum = parseInt(trackId, 10);
    if (isNaN(trackIdNum)) throw new Error("Invalid track ID");
    const track = await api.getTrack(trackIdNum);
    const relatedTracks = await api.getRelatedTracks(trackIdNum, 10);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Here's a track I like:\n\n${JSON.stringify(
              track,
              null,
              2
            )}\n\nAnd here are some related tracks:\n\n${JSON.stringify(
              relatedTracks,
              null,
              2
            )}\n\nPlease analyze these tracks and explain what they have in common, and suggest which ones I might enjoy most based on the original track's characteristics.`,
          },
        },
      ],
    };
  }
);

server.prompt(
  "create-playlist-from-recommendations",
  "Create a playlist from personalized recommendations",
  {
    playlistName: z.string(),
    description: z.string().optional(),
  },
  async ({ playlistName, description }) => {
    const recommendedTracks = await api.getRecommendedTracks(20);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I'd like to create a new playlist called "${playlistName}"${
              description ? ` with description "${description}"` : ""
            } using these recommended tracks:\n\n${JSON.stringify(
              recommendedTracks,
              null,
              2
            )}\n\nPlease analyze these tracks and suggest how to organize them into a cohesive playlist, including what order they should be in and why.`,
          },
        },
      ],
    };
  }
);

server.prompt(
  "discover-new-music",
  "Get personalized music discovery recommendations",
  {
    genres: z.string().optional(),
    mood: z.string().optional(),
  },
  async ({ genres, mood }) => {
    const genresList = genres?.split(",").map((g) => g.trim());
    const likes = await api.getUserLikes(20);
    const charts = await api.getCharts("trending", genresList?.[0], 20);
    const recommended = await api.getRecommendedTracks(20);

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I'm looking for new music to discover${
              genres ? ` in these genres: ${genres}` : ""
            }${
              mood ? ` with a ${mood} mood` : ""
            }. Here's some context about my taste:\n\nTracks I've liked:\n${JSON.stringify(
              likes,
              null,
              2
            )}\n\nTrending tracks${
              genresList?.[0] ? ` in ${genresList[0]}` : ""
            }:\n${JSON.stringify(
              charts,
              null,
              2
            )}\n\nPersonalized recommendations:\n${JSON.stringify(
              recommended,
              null,
              2
            )}\n\nBased on this information, please suggest new tracks, artists, or genres I might enjoy and explain why. Consider factors like musical style, mood, and production elements.`,
          },
        },
      ],
    };
  }
);

// Resource templates
server.resource(
  "user-profile",
  "soundcloud://users/{userId}/profile",
  async (uri) => {
    try {
      const userId = uri.searchParams.get("userId");
      if (!userId) throw new Error("userId is required");
      const user = await api.request<SoundCloudUser>(`/users/${userId}`);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(user, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to fetch user profile: ${error}`);
    }
  }
);

server.resource("track", "soundcloud://tracks/{trackId}", async (uri) => {
  try {
    const trackId = uri.searchParams.get("trackId");
    if (!trackId) throw new Error("trackId is required");
    const track = await api.getTrack(Number(trackId));
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(track, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to fetch track: ${error}`);
  }
});

server.resource(
  "playlist",
  "soundcloud://playlists/{playlistId}",
  async (uri) => {
    try {
      const playlistId = uri.searchParams.get("playlistId");
      if (!playlistId) throw new Error("playlistId is required");
      const playlist = await api.getPlaylist(Number(playlistId));
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(playlist, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to fetch playlist: ${error}`);
    }
  }
);

server.resource("charts", "soundcloud://charts/{kind}/{genre}", async (uri) => {
  try {
    const kind = uri.searchParams.get("kind");
    const genre = uri.searchParams.get("genre");
    if (!kind || !genre) throw new Error("kind and genre are required");
    const charts = await api.getCharts(kind as "top" | "trending", genre, 50);
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(charts, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to fetch charts: ${error}`);
  }
});

// Static resource for current user's profile
server.resource("my-profile", "soundcloud://me/profile", async (uri) => {
  try {
    const user = await api.getCurrentUser();
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(user, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to fetch current user profile: ${error}`);
  }
});

// Static resource for current user's playlists
server.resource("my-playlists", "soundcloud://me/playlists", async (uri) => {
  try {
    const playlists = await api.getUserPlaylists();
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(playlists, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to fetch user playlists: ${error}`);
  }
});

// Static resource for current user's likes
server.resource("my-likes", "soundcloud://me/likes", async (uri) => {
  try {
    const likes = await api.getUserLikes();
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(likes, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to fetch user likes: ${error}`);
  }
});

// Get current user's profile
server.tool(
  "get-profile",
  "Get the authenticated user's SoundCloud profile",
  {},
  async () => {
    try {
      const user = await api.getCurrentUser();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(user, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching profile: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get user's likes
server.tool(
  "get-likes",
  "Get the authenticated user's liked tracks",
  {
    limit: z.number().min(1).max(200).optional().default(50),
    nextPage: z.string().optional(),
  },
  async ({ limit, nextPage }) => {
    try {
      const likes = nextPage
        ? await api.getNextPage(nextPage)
        : await api.getUserLikes(limit);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(likes, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching likes: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get user's playlists
server.tool(
  "get-playlists",
  "Get the authenticated user's playlists",
  {
    limit: z.number().min(1).max(200).optional().default(50),
    nextPage: z.string().optional(),
  },
  async ({ limit, nextPage }) => {
    try {
      const playlists = nextPage
        ? await api.getNextPage(nextPage)
        : await api.getUserPlaylists(limit);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(playlists, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching playlists: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get track info
server.tool(
  "get-track",
  "Get information about a specific track",
  {
    trackId: z.number().min(1),
  },
  async ({ trackId }) => {
    try {
      const track = await api.getTrack(trackId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(track, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching track: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get playlist info
server.tool(
  "get-playlist",
  "Get information about a specific playlist",
  {
    playlistId: z.number().min(1),
  },
  async ({ playlistId }) => {
    try {
      const playlist = await api.getPlaylist(playlistId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(playlist, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching playlist: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Search tracks
server.tool(
  "search-tracks",
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
  async ({ query, limit, ...filters }) => {
    try {
      const results = await api.searchTracks(query, limit, filters);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching tracks: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get charts
server.tool(
  "get-charts",
  "Get top or trending tracks, optionally filtered by genre",
  {
    kind: z.enum(["top", "trending"]).optional(),
    genre: z.string().optional(),
    limit: z.number().min(1).max(200).optional(),
  },
  async ({ kind, genre, limit }) => {
    try {
      const charts = await api.getCharts(kind, genre, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(charts, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching charts: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Like a track
server.tool(
  "like-track",
  "Like a track",
  {
    trackId: z.number().min(1),
  },
  async ({ trackId }) => {
    try {
      await api.likeTrack(trackId);
      return {
        content: [
          {
            type: "text",
            text: `Successfully liked track ${trackId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error liking track: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Unlike a track
server.tool(
  "unlike-track",
  "Unlike a track",
  {
    trackId: z.number().min(1),
  },
  async ({ trackId }) => {
    try {
      await api.unlikeTrack(trackId);
      return {
        content: [
          {
            type: "text",
            text: `Successfully unliked track ${trackId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error unliking track: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Follow a user
server.tool(
  "follow-user",
  "Follow a user",
  {
    userId: z.number().min(1),
  },
  async ({ userId }) => {
    try {
      await api.followUser(userId);
      return {
        content: [
          {
            type: "text",
            text: `Successfully followed user ${userId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error following user: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Unfollow a user
server.tool(
  "unfollow-user",
  "Unfollow a user",
  {
    userId: z.number().min(1),
  },
  async ({ userId }) => {
    try {
      await api.unfollowUser(userId);
      return {
        content: [
          {
            type: "text",
            text: `Successfully unfollowed user ${userId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error unfollowing user: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Add a comment
server.tool(
  "add-comment",
  "Add a comment to a track",
  {
    trackId: z.number().min(1),
    body: z.string(),
    timestamp: z.number().optional(),
  },
  async ({ trackId, body, timestamp }) => {
    try {
      await api.addComment(trackId, body, timestamp);
      return {
        content: [
          {
            type: "text",
            text: `Successfully added comment to track ${trackId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error adding comment: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get track comments
server.tool(
  "get-comments",
  "Get comments for a track",
  {
    trackId: z.number().min(1),
    limit: z.number().min(1).max(200).optional(),
  },
  async ({ trackId, limit }) => {
    try {
      const comments = await api.getTrackComments(trackId, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(comments, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching comments: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get related tracks
server.tool(
  "get-related-tracks",
  "Get tracks related to a specific track",
  {
    trackId: z.number().min(1),
    limit: z.number().min(1).max(200).optional(),
  },
  async ({ trackId, limit }) => {
    try {
      const tracks = await api.getRelatedTracks(trackId, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tracks, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching related tracks: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get recommended tracks
server.tool(
  "get-recommended-tracks",
  "Get personalized track recommendations",
  {
    limit: z.number().min(1).max(200).optional(),
  },
  async ({ limit }) => {
    try {
      const tracks = await api.getRecommendedTracks(limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tracks, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching recommended tracks: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get conversations
server.tool(
  "get-conversations",
  "Get your direct message conversations",
  {
    limit: z.number().min(1).max(200).optional(),
  },
  async ({ limit }) => {
    try {
      const conversations = await api.getConversations(limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(conversations, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching conversations: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get conversation details
server.tool(
  "get-conversation",
  "Get details of a specific conversation",
  {
    conversationId: z.number().min(1),
  },
  async ({ conversationId }) => {
    try {
      const conversation = await api.getConversation(conversationId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(conversation, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching conversation: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get conversation messages
server.tool(
  "get-messages",
  "Get messages from a conversation",
  {
    conversationId: z.number().min(1),
    limit: z.number().min(1).max(200).optional(),
  },
  async ({ conversationId, limit }) => {
    try {
      const messages = await api.getMessages(conversationId, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(messages, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching messages: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Send a message
server.tool(
  "send-message",
  "Send a message in a conversation",
  {
    conversationId: z.number().min(1),
    message: z.string(),
  },
  async ({ conversationId, message }) => {
    try {
      const result = await api.sendMessage(conversationId, message);
      return {
        content: [
          {
            type: "text",
            text: `Message sent successfully: ${JSON.stringify(
              result,
              null,
              2
            )}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error sending message: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start a new conversation
server.tool(
  "start-conversation",
  "Start a new conversation with a user",
  {
    userId: z.number().min(1),
    message: z.string(),
  },
  async ({ userId, message }) => {
    try {
      const conversation = await api.startConversation(userId, message);
      return {
        content: [
          {
            type: "text",
            text: `Conversation started: ${JSON.stringify(
              conversation,
              null,
              2
            )}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error starting conversation: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Mark conversation as read
server.tool(
  "mark-conversation-read",
  "Mark a conversation as read",
  {
    conversationId: z.number().min(1),
  },
  async ({ conversationId }) => {
    try {
      await api.markConversationAsRead(conversationId);
      return {
        content: [
          {
            type: "text",
            text: `Conversation ${conversationId} marked as read`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error marking conversation as read: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  try {
    // Start with client credentials
    const token = await oauth.getClientCredentialsToken();
    api = new SoundCloudAPI(token.access_token);
    console.error("Successfully obtained client credentials token");

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("SoundCloud MCP Server running on stdio");

    // Handle cleanup on exit
    const cleanup = async () => {
      console.error("Shutting down...");
      await oauth.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
