# SoundCloud MCP Server

A Model Context Protocol (MCP) server that provides access to SoundCloud's API, allowing AI models to interact with SoundCloud data and features.

## Features

- **Resources**
  - User profiles
  - Tracks
  - Playlists
  - Charts
  - Current user's profile, playlists, and likes

- **Tools**
  - Profile management (get profile)
  - Track operations (search, get info, like/unlike)
  - Playlist operations (get info)
  - Social features (follow/unfollow users)
  - Comments (add/get comments)
  - Messaging (conversations and direct messages)
  - Music discovery (charts, recommendations, related tracks)

- **Prompts**
  - Analyze music taste based on liked tracks
  - Discover similar tracks
  - Create playlists from recommendations
  - Get personalized music discovery recommendations

## Prerequisites

- Node.js 16 or higher
- A SoundCloud account
- A SoundCloud API access token

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/soundcloud-mcp.git
cd soundcloud-mcp
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Configuration

Create a `.env` file in the project root with your SoundCloud API access token:

```env
SOUNDCLOUD_ACCESS_TOKEN=your_access_token_here
```

## Usage

### Standalone Testing

You can run the server directly to test it:

```bash
node build/index.js
```

### Integration with Claude Desktop

1. Open your Claude Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the server configuration:

```json
{
  "mcpServers": {
    "soundcloud": {
      "command": "node",
      "args": ["/absolute/path/to/soundcloud-mcp/build/index.js"],
      "env": {
        "SOUNDCLOUD_ACCESS_TOKEN": "your_access_token_here"
      }
    }
  }
}
```

3. Restart Claude Desktop

### Using the MCP Inspector

You can use the MCP Inspector to test the server's functionality:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

## Available Resources

### User Profile

- URI Template: `soundcloud://users/{userId}/profile`
- Returns user information including name, bio, and stats

### Track

- URI Template: `soundcloud://tracks/{trackId}`
- Returns track information including title, artist, and audio details

### Playlist

- URI Template: `soundcloud://playlists/{playlistId}`
- Returns playlist information including tracks and metadata

### Charts

- URI Template: `soundcloud://charts/{kind}/{genre}`
- Returns top or trending tracks for a specific genre

### Static Resources

- `soundcloud://me/profile` - Current user's profile
- `soundcloud://me/playlists` - Current user's playlists
- `soundcloud://me/likes` - Current user's liked tracks

## Available Tools

### Profile Management

- `get-profile` - Get the authenticated user's profile

### Track Operations

- `get-track` - Get track information
- `search-tracks` - Search for tracks with filters
- `like-track` - Like a track
- `unlike-track` - Unlike a track
- `get-related-tracks` - Get tracks related to a specific track
- `get-recommended-tracks` - Get personalized track recommendations

### Playlist Operations

- `get-playlist` - Get playlist information
- `get-playlists` - Get user's playlists

### Social Features

- `follow-user` - Follow a user
- `unfollow-user` - Unfollow a user

### Comments

- `add-comment` - Add a comment to a track
- `get-comments` - Get comments for a track

### Messaging

- `get-conversations` - Get direct message conversations
- `get-conversation` - Get conversation details
- `get-messages` - Get messages from a conversation
- `send-message` - Send a message in a conversation
- `start-conversation` - Start a new conversation
- `mark-conversation-read` - Mark a conversation as read

## Available Prompts

### analyze-music-taste

Analyzes a user's music taste based on their liked tracks, providing insights about preferred genres, artists, and musical elements.

### discover-similar-tracks

Takes a track ID and finds similar tracks, explaining what they have in common and suggesting which ones the user might enjoy most.

### create-playlist-from-recommendations

Creates a playlist from personalized recommendations, organizing tracks in a cohesive way.

### discover-new-music

Gets personalized music discovery recommendations based on liked tracks, trending music, and user preferences.

## Development

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

### Testing with the Inspector

```bash
npm run test:inspector
```

## Error Handling

The server implements comprehensive error handling:

- Input validation for all parameters
- Proper error messages for API failures
- Rate limit handling
- Authentication error handling

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
