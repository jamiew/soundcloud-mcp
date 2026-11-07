// Response shapes we read. Each schema lists only the fields this server uses
// or returns in compact results. `looseObject` keeps every other field, so
// `verbose` results still carry the full upstream object. SoundCloud omits or
// nulls fields freely, so entity fields are all optional.

import { z } from "zod";

const text = z.string().nullish();
const count = z.number().nullish();

/** The few user fields that tracks and playlists repeat for their creator. */
const creatorShape = {
	id: count,
	urn: text,
	/** Display name. Not unique; never use it for access control. */
	username: text,
	permalink_url: text,
};

const userShape = {
	...creatorShape,
	/** Profile URL slug. Unique across accounts. */
	permalink: text,
	full_name: text,
	avatar_url: text,
	city: text,
	country: text,
	followers_count: count,
	followings_count: count,
	track_count: count,
	playlist_count: count,
	public_favorites_count: count,
	station_urn: text,
};

const trackShape = {
	id: count,
	urn: text,
	title: text,
	/** Credited artist, when it differs from the uploader. */
	metadata_artist: text,
	duration: count,
	genre: text,
	tag_list: text,
	bpm: count,
	/** `playable`, `preview`, or `blocked`. Blocked tracks have no stream. */
	access: text,
	sharing: text,
	created_at: text,
	permalink_url: text,
	artwork_url: text,
	playback_count: count,
	favoritings_count: count,
	reposts_count: count,
	comment_count: count,
	station_urn: text,
};

// Stations (system playlists) share this shape; they hold only the tracks the
// caller can see and have no numeric id.
const playlistShape = {
	id: count,
	urn: text,
	title: text,
	playlist_type: text,
	duration: count,
	genre: text,
	tag_list: text,
	sharing: text,
	created_at: text,
	permalink_url: text,
	artwork_url: text,
	track_count: count,
	likes_count: count,
	repost_count: count,
};

export const UserSchema = z.looseObject(userShape);
export const TrackSchema = z.looseObject({ ...trackShape, user: UserSchema.nullish() });
export const PlaylistSchema = z.looseObject({
	...playlistShape,
	user: UserSchema.nullish(),
	tracks: z.array(TrackSchema).nullish(),
});

// Compact results: `z.object` strips every field the shapes above leave out.
// Tracks and playlists name their creator rather than repeating the profile.
const creator = z.object(creatorShape).nullish();
export const CompactUser = z.object(userShape);
export const CompactTrack = z.object({ ...trackShape, user: creator });
export const CompactPlaylist = z.object({
	...playlistShape,
	user: creator,
	tracks: z.array(CompactTrack).nullish(),
});

export type SoundCloudUser = z.infer<typeof UserSchema>;
export type SoundCloudTrack = z.infer<typeof TrackSchema>;
export type SoundCloudPlaylist = z.infer<typeof PlaylistSchema>;

export const CommentSchema = z.looseObject({ user: UserSchema.nullish() });

/** An external link on a profile, from /users/{urn}/web-profiles. */
export const WebProfileSchema = z.looseObject({ service: text, title: text, url: text });
export type WebProfile = z.infer<typeof WebProfileSchema>;

// /me/feed/tracks returns activity wrappers, not bare tracks: each entry has a
// `type` like "track" or "track:repost" and carries the track inside.
export const FeedItemSchema = z.looseObject({
	type: text,
	created_at: text,
	track: TrackSchema.nullish(),
	playlist: PlaylistSchema.nullish(),
	user: UserSchema.nullish(),
});

// Time-limited playback URLs from /tracks/{urn}/streams. The progressive
// `http_mp3_128_url` was removed on 2026-08-12; full-length playback is HLS.
export const TrackStreamsSchema = z.looseObject({
	hls_mp3_128_url: text,
	hls_aac_160_url: text,
	preview_mp3_128_url: text,
});
export type TrackStreams = z.infer<typeof TrackStreamsSchema>;

/** Cursor-paginated collection (requires linked_partitioning=true). */
export function pageOf<T extends z.ZodType>(item: T) {
	return z.looseObject({ collection: z.array(item), next_href: z.string().nullish() });
}

/** SoundCloud's token endpoint response. Refresh tokens are single-use. */
export const OAuthTokenResponseSchema = z.looseObject({
	access_token: z.string(),
	refresh_token: z.string().optional(),
	expires_in: z.number().optional(),
	scope: z.string().optional(),
	token_type: z.string().optional(),
});
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;
