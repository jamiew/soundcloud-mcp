export interface SoundCloudUser {
  id: number;
  permalink: string;
  username: string;
  uri: string;
  permalink_url: string;
  avatar_url: string;
  country: string;
  full_name: string;
  description: string;
  followers_count: number;
  followings_count: number;
  likes_count: number;
  playlist_count: number;
  track_count: number;
}

export interface SoundCloudTrack {
  id: number;
  title: string;
  permalink: string;
  permalink_url: string;
  uri: string;
  sharing: string;
  embeddable_by: string;
  purchase_url: string | null;
  artwork_url: string | null;
  description: string | null;
  duration: number;
  genre: string | null;
  tag_list: string;
  label_name: string | null;
  release: string | null;
  user_id: number;
  user: SoundCloudUser;
  playback_count: number;
  likes_count: number;
  comment_count: number;
  downloadable: boolean;
  download_count: number;
  stream_url: string;
  access: "playable" | "preview" | "blocked";
}

export interface SoundCloudPlaylist {
  id: number;
  title: string;
  permalink: string;
  permalink_url: string;
  uri: string;
  sharing: string;
  embeddable_by: string;
  purchase_url: string | null;
  artwork_url: string | null;
  description: string | null;
  duration: number;
  genre: string | null;
  tag_list: string;
  label_name: string | null;
  release: string | null;
  user_id: number;
  user: SoundCloudUser;
  track_count: number;
  tracks: SoundCloudTrack[];
}

export interface SoundCloudLike {
  created_at: string;
  track: SoundCloudTrack;
}

export interface SoundCloudError {
  code: number;
  message: string;
  link?: string;
  status?: string;
  errors?: Array<{ error_message: string }>;
  error?: string | null;
}

export interface Comment {
  id: number;
  body: string;
  timestamp?: number;
  user_id: number;
  user: SoundCloudUser;
  created_at: string;
  track_id: number;
}

export interface Message {
  id: number;
  body: string;
  timestamp: string;
  user_id: number;
  user: SoundCloudUser;
  conversation_id: number;
  read: boolean;
}

export interface Conversation {
  id: number;
  created_at: string;
  last_message: string;
  participants: SoundCloudUser[];
  unread_messages_count: number;
}

export interface PaginatedResponse<T> {
  collection: T[];
  next_href?: string;
}

// OAuth Types
export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}
