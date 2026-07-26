// Response shapes we actually read. SoundCloud returns far more fields than
// this; anything not listed here is passed through untouched to the model.

export interface SoundCloudUser {
	id: number;
	urn: string;
	username: string;
	permalink_url: string;
	avatar_url: string | null;
	description: string | null;
	city?: string | null;
	country_code?: string | null;
	followers_count: number;
	followings_count: number;
	track_count: number;
	playlist_count: number;
}

export interface SoundCloudTrack {
	id: number;
	urn: string;
	title: string;
	permalink_url: string;
	artwork_url: string | null;
	description: string | null;
	duration: number;
	genre: string | null;
	tag_list: string;
	created_at: string;
	user: SoundCloudUser;
	playback_count: number;
	likes_count: number;
	comment_count: number;
	access: "playable" | "preview" | "blocked";
}

export interface SoundCloudPlaylist {
	id: number;
	urn: string;
	title: string;
	permalink_url: string;
	artwork_url: string | null;
	description: string | null;
	duration: number;
	genre: string | null;
	created_at: string;
	user: SoundCloudUser;
	track_count: number;
	tracks?: SoundCloudTrack[];
}

export interface SoundCloudComment {
	id: number;
	body: string;
	timestamp: number | null;
	created_at: string;
	user: SoundCloudUser;
}

/** A like/repost wrapper: the entity plus when it was added. */
export interface SoundCloudLike {
	created_at: string;
	track?: SoundCloudTrack;
	playlist?: SoundCloudPlaylist;
}

/** Time-limited playback URLs from /tracks/{urn}/streams. */
export interface TrackStreams {
	http_mp3_128_url?: string;
	hls_mp3_128_url?: string;
	hls_aac_160_url?: string;
	preview_mp3_128_url?: string;
}

/** Cursor-paginated collection (requires linked_partitioning=true). */
export interface Paginated<T> {
	collection: T[];
	next_href?: string | null;
}

/** SoundCloud's token endpoint response. Refresh tokens are single-use. */
export interface OAuthTokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope?: string;
	token_type?: string;
}
