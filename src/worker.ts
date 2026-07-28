import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { SoundCloudHandler } from "./worker/handler";
import { ICON_DATA_URI } from "./worker/icon";
import { isAccountAllowed, type Props, refreshTokens } from "./worker/oauth";
import { SoundCloudAuthError, SoundCloudClient } from "./worker/soundcloud";
import { registerTools } from "./worker/tools";

/** Working token state, persisted in the Durable Object. */
type State = {
	accessToken: string;
	refreshToken: string;
	/** Epoch milliseconds. */
	expiresAt: number;
};

export class SoundCloudMCP extends McpAgent<Env, State, Props> {
	server = new McpServer(
		{
			name: "soundcloud-mcp",
			title: "SoundCloud",
			version: "0.1.0",
			description:
				"Search SoundCloud, read your library, and manage playlists, follows, likes and reposts.",
			websiteUrl: "https://github.com/jamiew/soundcloud-mcp",
			icons: [{ src: ICON_DATA_URI, mimeType: "image/svg+xml", sizes: ["any"] }],
		},
		{
			instructions: [
				"SoundCloud, through the official API. The connected account is already authorized.",
				"",
				"- When the user pastes a soundcloud.com link, start with `resolve_url` — it returns the underlying track, user, or playlist.",
				"- Ids may be numeric or URNs (`soundcloud:tracks:123`). Both work; URNs are what SoundCloud prefers.",
				"- List results carry `next_href`. Pass it to `next_page` to page (default 50 per page, max 200).",
				"- There is no personalized recommendation endpoint. Seed `get_related_tracks` from something the user already likes, or read `get_feed`.",
			].join("\n"),
		}
	);

	initialState: State = { accessToken: "", refreshToken: "", expiresAt: 0 };

	/** Dedups concurrent refreshes so parallel tool calls share one request. */
	private refreshInFlight: Promise<string> | null = null;

	private async doRefresh(): Promise<string> {
		if (!this.refreshInFlight) {
			this.refreshInFlight = (async () => {
				try {
					const tokens = await refreshTokens({
						clientId: this.env.SOUNDCLOUD_CLIENT_ID,
						clientSecret: this.env.SOUNDCLOUD_CLIENT_SECRET,
						refreshToken: this.state.refreshToken,
					});
					// SoundCloud refresh tokens are single-use, so the rotated one
					// must be persisted or the next refresh fails for good.
					this.setState(tokens);
					return tokens.accessToken;
				} catch (error) {
					if (error instanceof Error && /invalid_grant|401|400/.test(error.message)) {
						throw new SoundCloudAuthError();
					}
					throw error;
				} finally {
					this.refreshInFlight = null;
				}
			})();
		}
		return this.refreshInFlight;
	}

	async init() {
		// Backup access gate; the primary check runs at the OAuth callback. If
		// this grant isn't allowed, register no tools at all.
		if (!isAccountAllowed([this.props?.username, this.props?.userId], this.env.ALLOWED_USERS)) {
			return;
		}

		// Seed persisted token state from the OAuth props on first run.
		if (!this.state.accessToken && this.props?.accessToken) {
			this.setState({
				accessToken: this.props.accessToken,
				refreshToken: this.props.refreshToken,
				expiresAt: this.props.expiresAt,
			});
		}

		const client = new SoundCloudClient({
			getAccessToken: async () => {
				// SoundCloud access tokens last an hour; refresh a minute early.
				if (Date.now() + 60_000 >= this.state.expiresAt) {
					return this.doRefresh();
				}
				return this.state.accessToken;
			},
			refreshAccessToken: () => this.doRefresh(),
		});

		registerTools(this.server, client);
	}
}

export default new OAuthProvider({
	apiHandlers: {
		"/mcp": SoundCloudMCP.serve("/mcp"),
		"/sse": SoundCloudMCP.serveSSE("/sse"),
	},
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	// biome-ignore lint/suspicious/noExplicitAny: OAuthProvider's handler type predates Hono's ExportedHandler shape
	defaultHandler: SoundCloudHandler as any,
});
