import { defineConfig } from "vitest/config";

// Everything runs on Node, including the worker's tests: none of them touch a
// workerd API, they stub `fetch` outright. That is also their limitation — see
// CLAUDE.md on why green tests here say nothing about the deployed worker.
//
// stdio/config.ts reads these at import time, so they must exist before any test
// imports it. The token file is a throwaway under the repo root that the
// tokenStore tests write to and clean up.
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
