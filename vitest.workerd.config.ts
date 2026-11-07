import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs the bundled Worker in workerd, with OAuthProvider and a local KV.
// SoundCloud is never called: these tests stop at the auth gate. Keep real
// secrets in .env out of the test worker; the bindings below stand in.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";

export default defineConfig({
	test: { include: ["src/**/*.workerd.test.ts"] },
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				bindings: {
					SOUNDCLOUD_CLIENT_ID: "test-client-id",
					SOUNDCLOUD_CLIENT_SECRET: "test-client-secret",
					COOKIE_ENCRYPTION_KEY: "test-cookie-key",
				},
			},
		}),
	],
});
