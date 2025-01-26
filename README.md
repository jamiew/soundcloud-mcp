# SoundCloud MCP Server

An MCP server that provides tools and resources for interacting with the SoundCloud API.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file by copying the example:

   ```bash
   cp .env.example .env
   ```

3. Configure your SoundCloud OAuth credentials in `.env`:

   ```bash
   SOUNDCLOUD_CLIENT_ID=your_client_id_here
   SOUNDCLOUD_CLIENT_SECRET=your_client_secret_here
   SOUNDCLOUD_REDIRECT_URI=your_redirect_uri_here
   ```

To get these credentials:

1. Go to https://soundcloud.com/you/apps
2. Create a new app or select an existing one
3. Copy the Client ID and Client Secret
4. Add your redirect URI in the app settings

## Running the Server

1. Build the server:

   ```bash
   npm run build
   ```

2. Start the server:

   ```bash
   npm start
   ```

The server will automatically start with client credentials flow for accessing public resources. For user-specific actions, you'll need to use the OAuth tools:

## OAuth Tools

1. `start-oauth-flow`: Start the OAuth authorization flow and get the authorization URL
2. `exchange-oauth-code`: Exchange an authorization code for access and refresh tokens
3. `refresh-token`: Refresh an expired access token
4. `get-client-credentials`: Get an access token using client credentials flow
5. `sign-out`: Sign out and invalidate the current access token

## Environment Variables

- `SOUNDCLOUD_CLIENT_ID`: Your SoundCloud app's client ID
- `SOUNDCLOUD_CLIENT_SECRET`: Your SoundCloud app's client secret
- `SOUNDCLOUD_REDIRECT_URI`: The URI where users will be redirected after authorization (e.g., http://localhost:3000/callback)

## OAuth Flows

### Client Credentials Flow

- Used for accessing public resources
- Automatically used when server starts
- No user authentication required
- Limited to public data only

### Authorization Code Flow (with PKCE)

1. Use `start-oauth-flow` to get authorization URL and PKCE challenge
2. User visits URL and authorizes the app
3. Use `exchange-oauth-code` with the returned code and PKCE verifier
4. Use `refresh-token` when the access token expires

## Development

Watch for changes and rebuild automatically:

```bash
npm run dev
```

In a separate terminal, run the server:

```bash
npm start
