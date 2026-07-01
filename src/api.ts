import { API_BASE } from "./config.js";
import { debug } from "./log.js";
import type {
  Comment,
  Conversation,
  Message,
  PaginatedResponse,
  SoundCloudError,
  SoundCloudLike,
  SoundCloudPlaylist,
  SoundCloudTrack,
  SoundCloudUser,
} from "./types.js";

export type TokenProvider = () => Promise<string>;

export class SoundCloudAPI {
  private getToken: TokenProvider;
  private baseUrl = API_BASE;

  // Accepts an async provider so every request uses a current (auto-refreshed)
  // token rather than one captured once at startup.
  constructor(tokenProvider: TokenProvider) {
    this.getToken = tokenProvider;
  }

  public async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
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
        message += " — log in with the connect_soundcloud tool (or `npm run auth`) for personal data.";
      }
      throw new Error(message);
    }

    // Some write endpoints return 200/201 with an empty body.
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
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
    const params = new URLSearchParams({ q: query, limit: limit.toString(), linked_partitioning: "true" });
    return this.request<PaginatedResponse<SoundCloudPlaylist>>(`/playlists?${params.toString()}`);
  }

  async searchUsers(query: string, limit = 50): Promise<PaginatedResponse<SoundCloudUser>> {
    const params = new URLSearchParams({ q: query, limit: limit.toString(), linked_partitioning: "true" });
    return this.request<PaginatedResponse<SoundCloudUser>>(`/users?${params.toString()}`);
  }

  async getTrack(trackId: number): Promise<SoundCloudTrack> {
    return this.request<SoundCloudTrack>(`/tracks/${trackId}`);
  }

  async getUser(userId: number): Promise<SoundCloudUser> {
    return this.request<SoundCloudUser>(`/users/${userId}`);
  }

  async getRelatedTracks(trackId: number, limit = 50): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>(`/tracks/${trackId}/related?limit=${limit}`);
  }

  async getTrackComments(trackId: number, limit = 50): Promise<PaginatedResponse<Comment>> {
    return this.request<PaginatedResponse<Comment>>(
      `/tracks/${trackId}/comments?limit=${limit}&linked_partitioning=true`
    );
  }

  // --- Social ---
  async likeTrack(trackId: number): Promise<void> {
    await this.request<void>(`/likes/tracks/${trackId}`, { method: "POST" });
  }

  async unlikeTrack(trackId: number): Promise<void> {
    await this.request<void>(`/likes/tracks/${trackId}`, { method: "DELETE" });
  }

  async followUser(userId: number): Promise<void> {
    await this.request<void>(`/me/followings/${userId}`, { method: "PUT" });
  }

  async unfollowUser(userId: number): Promise<void> {
    await this.request<void>(`/me/followings/${userId}`, { method: "DELETE" });
  }

  async addComment(trackId: number, body: string, timestamp?: number): Promise<void> {
    await this.request<void>(`/tracks/${trackId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: { body, timestamp } }),
    });
  }

  // --- Me / library ---
  async getCurrentUser(): Promise<SoundCloudUser> {
    return this.request<SoundCloudUser>("/me");
  }

  async getRecommendedTracks(limit = 50): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>(`/me/recommended/tracks?limit=${limit}`);
  }

  async getUserLikes(limit = 50): Promise<PaginatedResponse<SoundCloudLike>> {
    return this.request<PaginatedResponse<SoundCloudLike>>(
      `/me/likes/tracks?limit=${limit}&linked_partitioning=true`
    );
  }

  async getUserPlaylists(limit = 50): Promise<PaginatedResponse<SoundCloudPlaylist>> {
    return this.request<PaginatedResponse<SoundCloudPlaylist>>(
      `/me/playlists?limit=${limit}&linked_partitioning=true`
    );
  }

  async getPlaylist(playlistId: number): Promise<SoundCloudPlaylist> {
    return this.request<SoundCloudPlaylist>(`/playlists/${playlistId}`);
  }

  async getNextPage<T>(nextHref: string): Promise<PaginatedResponse<T>> {
    return this.request<PaginatedResponse<T>>(nextHref.replace(this.baseUrl, ""));
  }

  // --- Playlist writes ---
  async createPlaylist(
    title: string,
    options: { description?: string; sharing?: "public" | "private"; trackIds?: number[] } = {}
  ): Promise<SoundCloudPlaylist> {
    const playlist: Record<string, unknown> = {
      title,
      sharing: options.sharing ?? "private",
    };
    if (options.description) playlist.description = options.description;
    if (options.trackIds) playlist.tracks = options.trackIds.map((id) => ({ id }));
    return this.request<SoundCloudPlaylist>("/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlist }),
    });
  }

  async updatePlaylist(
    playlistId: number,
    updates: { title?: string; description?: string; sharing?: "public" | "private"; trackIds?: number[] }
  ): Promise<SoundCloudPlaylist> {
    const playlist: Record<string, unknown> = {};
    if (updates.title !== undefined) playlist.title = updates.title;
    if (updates.description !== undefined) playlist.description = updates.description;
    if (updates.sharing !== undefined) playlist.sharing = updates.sharing;
    if (updates.trackIds !== undefined) playlist.tracks = updates.trackIds.map((id) => ({ id }));
    return this.request<SoundCloudPlaylist>(`/playlists/${playlistId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlist }),
    });
  }

  // SoundCloud has no append endpoint; the full track list must be re-sent.
  async addTracksToPlaylist(playlistId: number, trackIds: number[]): Promise<SoundCloudPlaylist> {
    const existing = await this.getPlaylist(playlistId);
    const ids = [...(existing.tracks ?? []).map((t) => t.id), ...trackIds];
    return this.updatePlaylist(playlistId, { trackIds: ids });
  }

  async removeTrackFromPlaylist(playlistId: number, trackId: number): Promise<SoundCloudPlaylist> {
    const existing = await this.getPlaylist(playlistId);
    const ids = (existing.tracks ?? []).map((t) => t.id).filter((id) => id !== trackId);
    return this.updatePlaylist(playlistId, { trackIds: ids });
  }

  async deletePlaylist(playlistId: number): Promise<void> {
    await this.request<void>(`/playlists/${playlistId}`, { method: "DELETE" });
  }

  // --- Messaging ---
  async getConversations(limit = 50): Promise<PaginatedResponse<Conversation>> {
    return this.request<PaginatedResponse<Conversation>>(
      `/me/conversations?limit=${limit}&linked_partitioning=true`
    );
  }

  async getConversation(conversationId: number): Promise<Conversation> {
    return this.request<Conversation>(`/me/conversations/${conversationId}`);
  }

  async getMessages(conversationId: number, limit = 50): Promise<PaginatedResponse<Message>> {
    return this.request<PaginatedResponse<Message>>(
      `/me/conversations/${conversationId}/messages?limit=${limit}&linked_partitioning=true`
    );
  }

  async sendMessage(conversationId: number, body: string): Promise<Message> {
    return this.request<Message>(`/me/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { body } }),
    });
  }

  async startConversation(userId: number, message: string): Promise<Conversation> {
    return this.request<Conversation>("/me/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation: { participant_ids: [userId], initial_message: message } }),
    });
  }

  async markConversationAsRead(conversationId: number): Promise<void> {
    await this.request<void>(`/me/conversations/${conversationId}/mark-read`, { method: "PUT" });
  }
}
