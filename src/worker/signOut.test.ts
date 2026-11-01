import { describe, expect, it, vi } from "vitest";
import { deleteUserGrants, signOut } from "./signOut.js";

/** Grants split across two list pages, the way KV pages a large listing. */
function grantStore() {
	const ids = new Set(["g1", "g2", "g3"]);
	return {
		ids,
		listUserGrants: vi.fn(async (_userId: string, options: { cursor?: string } = {}) => {
			const all = [...ids];
			const page = options.cursor ? all.slice(2) : all.slice(0, 2);
			return {
				items: page.map((id) => ({ id })),
				...(options.cursor ? {} : { cursor: "next" }),
			};
		}),
		revokeGrant: vi.fn(async (id: string) => {
			ids.delete(id);
		}),
	} as unknown as Parameters<typeof deleteUserGrants>[0] & { ids: Set<string> };
}

describe("deleteUserGrants", () => {
	it("deletes grants on every page", async () => {
		const store = grantStore();
		await expect(deleteUserGrants(store, "42")).resolves.toBe(3);
		expect(store.ids.size).toBe(0);
	});
});

describe("signOut", () => {
	it("still deletes stored grants when SoundCloud rejects the revocation", async () => {
		const store = grantStore();
		const sc = { disconnect: vi.fn(async () => Promise.reject(new Error("400"))) };
		vi.spyOn(console, "error").mockImplementation(() => {});

		const message = await signOut(sc, store, "42");

		expect(message).toContain("did not confirm");
		expect(store.ids.size).toBe(0);
	});
});
