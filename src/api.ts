import type {
  SoundCloudUser,
  SoundCloudTrack,
  SoundCloudPlaylist,
  SoundCloudLike,
  SoundCloudError,
  PaginatedResponse,
  Message,
  Conversation,
  Comment,
} from "./types.js";

export class SoundCloudAPI {
  private accessToken: string;
  private baseUrl = "https://api.soundcloud.com";

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  // Track discovery methods
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

    if (filters?.genres?.length) {
      params.append("genres", filters.genres.join(","));
    }
    if (filters?.tags?.length) {
      params.append("tags", filters.tags.join(","));
    }
    if (filters?.bpmFrom) {
      params.append("bpm[from]", filters.bpmFrom.toString());
    }
    if (filters?.bpmTo) {
      params.append("bpm[to]", filters.bpmTo.toString());
    }
    if (filters?.durationFrom) {
      params.append("duration[from]", filters.durationFrom.toString());
    }
    if (filters?.durationTo) {
      params.append("duration[to]", filters.durationTo.toString());
    }
    if (filters?.access?.length) {
      params.append("access", filters.access.join(","));
    }

    return this.request<PaginatedResponse<SoundCloudTrack>>(
      `/tracks?${params.toString()}`
    );
  }

  async getCharts(
    kind: "top" | "trending" = "top",
    genre?: string,
    limit = 50
  ): Promise<PaginatedResponse<SoundCloudTrack>> {
    const params = new URLSearchParams({
      kind,
      limit: limit.toString(),
      linked_partitioning: "true",
    });

    if (genre) {
      params.append("genre", genre);
    }

    return this.request<PaginatedResponse<SoundCloudTrack>>(
      `/charts/tracks?${params.toString()}`
    );
  }

  // Social interaction methods
  async likeTrack(trackId: number): Promise<void> {
    await this.request<void>(`/likes/tracks/${trackId}`, {
      method: "POST",
    });
  }

  async unlikeTrack(trackId: number): Promise<void> {
    await this.request<void>(`/likes/tracks/${trackId}`, {
      method: "DELETE",
    });
  }

  async followUser(userId: number): Promise<void> {
    await this.request<void>(`/me/followings/${userId}`, {
      method: "PUT",
    });
  }

  async unfollowUser(userId: number): Promise<void> {
    await this.request<void>(`/me/followings/${userId}`, {
      method: "DELETE",
    });
  }

  async addComment(
    trackId: number,
    body: string,
    timestamp?: number
  ): Promise<void> {
    const comment = {
      comment: {
        body,
        timestamp,
      },
    };

    await this.request<void>(`/tracks/${trackId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(comment),
    });
  }

  async getTrackComments(
    trackId: number,
    limit = 50
  ): Promise<PaginatedResponse<Comment>> {
    return this.request<PaginatedResponse<Comment>>(
      `/tracks/${trackId}/comments?limit=${limit}&linked_partitioning=true`
    );
  }

  async getRelatedTracks(
    trackId: number,
    limit = 50
  ): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>(
      `/tracks/${trackId}/related?limit=${limit}`
    );
  }

  async getRecommendedTracks(limit = 50): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>(
      `/me/recommended/tracks?limit=${limit}`
    );
  }

  public async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      accept: "application/json; charset=utf-8",
      Authorization: `OAuth ${this.accessToken}`,
      ...options.headers,
    };

    console.log(`Making request to ${url}`);
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const endTime = Date.now();
      console.log(`Request completed in ${endTime - startTime}ms`);

      if (!response.ok) {
        const error = (await response.json()) as SoundCloudError;
        throw new Error(error.message || "API request failed");
      }

      return response.json() as Promise<T>;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  async getCurrentUser(): Promise<SoundCloudUser> {
    return this.request<SoundCloudUser>("/me");
  }

  async getUserLikes(limit = 50): Promise<PaginatedResponse<SoundCloudLike>> {
    return this.request<PaginatedResponse<SoundCloudLike>>(
      `/me/likes/tracks?limit=${limit}&linked_partitioning=true`
    );
  }

  async getUserPlaylists(
    limit = 50
  ): Promise<PaginatedResponse<SoundCloudPlaylist>> {
    return this.request<PaginatedResponse<SoundCloudPlaylist>>(
      `/me/playlists?limit=${limit}&linked_partitioning=true`
    );
  }

  async getTrack(trackId: number): Promise<SoundCloudTrack> {
    return this.request<SoundCloudTrack>(`/tracks/${trackId}`);
  }

  async getPlaylist(playlistId: number): Promise<SoundCloudPlaylist> {
    return this.request<SoundCloudPlaylist>(`/playlists/${playlistId}`);
  }

  async getNextPage<T>(nextHref: string): Promise<PaginatedResponse<T>> {
    // Remove base URL from nextHref since we add it in request()
    const path = nextHref.replace(this.baseUrl, "");
    return this.request<PaginatedResponse<T>>(path);
  }

  // Messaging methods
  async getConversations(limit = 50): Promise<PaginatedResponse<Conversation>> {
    return this.request<PaginatedResponse<Conversation>>(
      `/me/conversations?limit=${limit}&linked_partitioning=true`
    );
  }

  async getConversation(conversationId: number): Promise<Conversation> {
    return this.request<Conversation>(`/me/conversations/${conversationId}`);
  }

  async getMessages(
    conversationId: number,
    limit = 50
  ): Promise<PaginatedResponse<Message>> {
    return this.request<PaginatedResponse<Message>>(
      `/me/conversations/${conversationId}/messages?limit=${limit}&linked_partitioning=true`
    );
  }

  async sendMessage(conversationId: number, body: string): Promise<Message> {
    return this.request<Message>(
      `/me/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: { body } }),
      }
    );
  }

  async startConversation(
    userId: number,
    message: string
  ): Promise<Conversation> {
    return this.request<Conversation>("/me/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversation: {
          participant_ids: [userId],
          initial_message: message,
        },
      }),
    });
  }

  async markConversationAsRead(conversationId: number): Promise<void> {
    await this.request<void>(`/me/conversations/${conversationId}/mark-read`, {
      method: "PUT",
    });
  }
}
