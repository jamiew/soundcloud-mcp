import { defineConfig } from "vitest/config";

// Tests run on Node with stubbed fetch, not workerd.
// Set these before stdio/config.ts loads. Token tests clean up the scratch file.
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		env: {
			SOUNDCLOUD_CLIENT_ID: "test-client-id",
			SOUNDCLOUD_CLIENT_SECRET: "test-client-secret",
			SOUNDCLOUD_REDIRECT_URI: "http://localhost:8888/callback",
			SOUNDCLOUD_TOKEN_FILE: "./.tmp-test-tokens.json",
		},
	},
});
