import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundCloudAPI, toUrn } from "./api.js";

type FakeRes = {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
};

const res = (opts: FakeRes) => ({
  ok: opts.ok,
  status: opts.status,
  json: async () => opts.body ?? {},
  text: async () => opts.text ?? "",
});

const api = new SoundCloudAPI(async () => "test-token");

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toUrn", () => {
  it("normalizes numeric and string ids", () => {
    expect(toUrn("tracks", 3419282)).toBe("soundcloud:tracks:3419282");
    expect(toUrn("users", "34532")).toBe("soundcloud:users:34532");
  });

  it("passes existing URNs through untouched", () => {
    expect(toUrn("tracks", "soundcloud:tracks:99")).toBe("soundcloud:tracks:99");
  });
});

describe("SoundCloudAPI.request", () => {
  it("sends the OAuth Authorization header and accept header", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      res({ ok: true, status: 200, text: JSON.stringify({ id: 1 }) })
    );
    await api.getTrack(1);
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("OAuth test-token");
    expect(headers.accept).toBe("application/json; charset=utf-8");
    expect(url).toBe("https://api.soundcloud.com/tracks/soundcloud:tracks:1");
  });

  it("returns undefined on 204", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res({ ok: true, status: 204 }));
    const out = await api.request("/x");
    expect(out).toBeUndefined();
  });

  it("issues a POST for likeTrack", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res({ ok: true, status: 204 }));
    await api.likeTrack(5);
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.soundcloud.com/likes/tracks/soundcloud:tracks:5");
    expect(options.method).toBe("POST");
  });

  it("returns undefined on an empty 200 body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res({ ok: true, status: 200, text: "" }));
    expect(await api.request("/y")).toBeUndefined();
  });

  it("parses a JSON success body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      res({ ok: true, status: 200, text: JSON.stringify({ hello: "world" }) })
    );
    expect(await api.request("/z")).toEqual({ hello: "world" });
  });

  it("appends the login hint on a 401 error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      res({ ok: false, status: 401, body: { message: "Unauthorized" } })
    );
    await expect(api.request("/me")).rejects.toThrow("log in with the connect_soundcloud tool");
  });

  it("extracts the API error message on other failures", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      res({ ok: false, status: 403, body: { message: "Forbidden" } })
    );
    await expect(api.request("/x")).rejects.toThrow("Forbidden");
  });
});

describe("SoundCloudAPI.searchTracks", () => {
  beforeEach(() => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      res({ ok: true, status: 200, text: JSON.stringify({ collection: [], next_href: undefined }) })
    );
  });

  it("builds the base query", async () => {
    await api.searchTracks("techno", 10);
    const fetchUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(fetchUrl.startsWith("https://api.soundcloud.com/tracks?")).toBe(true);
    expect(fetchUrl).toContain("q=techno");
    expect(fetchUrl).toContain("limit=10");
    expect(fetchUrl).toContain("linked_partitioning=true");
  });

  it("appends filters", async () => {
    await api.searchTracks("x", 5, {
      genres: ["house", "techno"],
      bpmFrom: 120,
      durationTo: 300000,
      access: ["playable"],
    });
    const fetchUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const u = new URL(fetchUrl);
    expect(u.searchParams.get("genres")).toBe("house,techno");
    expect(u.searchParams.get("bpm[from]")).toBe("120");
    expect(u.searchParams.get("duration[to]")).toBe("300000");
    expect(u.searchParams.get("access")).toBe("playable");
  });
});

describe("SoundCloudAPI.getTrackStreams", () => {
  it("requests the track streams endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      res({ ok: true, status: 200, text: JSON.stringify({ http_mp3_128_url: "https://cf/x.mp3" }) })
    );
    const streams = await api.getTrackStreams(42);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe("https://api.soundcloud.com/tracks/soundcloud:tracks:42/streams");
    expect(streams.http_mp3_128_url).toBe("https://cf/x.mp3");
  });
});

describe("SoundCloudAPI playlist track refs", () => {
  it("sends every track as a URN, which is what survives ids above int32", async () => {
    const bigId = 2_147_483_648; // 2^31, one past int32 max — mangled when sent as a number
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      res({ ok: true, status: 200, text: JSON.stringify({ id: 9 }) })
    );
    await api.createPlaylist("mix", { trackIds: [5, bigId] });
    const options = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(options.body as string).playlist.tracks).toEqual([
      { urn: "soundcloud:tracks:5" },
      { urn: `soundcloud:tracks:${bigId}` },
    ]);
  });
});

describe("SoundCloudAPI playlist track re-send", () => {
  it("addTracksToPlaylist re-sends existing plus new ids", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        res({ ok: true, status: 200, text: JSON.stringify({ id: 7, tracks: [{ id: 1 }, { id: 2 }] }) })
      )
      .mockResolvedValueOnce(res({ ok: true, status: 200, text: JSON.stringify({ id: 7 }) }));
    await api.addTracksToPlaylist(7, [3]);
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(url).toBe("https://api.soundcloud.com/playlists/soundcloud:playlists:7");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body as string).playlist.tracks).toEqual([
      { urn: "soundcloud:tracks:1" },
      { urn: "soundcloud:tracks:2" },
      { urn: "soundcloud:tracks:3" },
    ]);
  });

  it("removeTrackFromPlaylist drops the id", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        res({
          ok: true,
          status: 200,
          text: JSON.stringify({ id: 7, tracks: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
        })
      )
      .mockResolvedValueOnce(res({ ok: true, status: 200, text: JSON.stringify({ id: 7 }) }));
    await api.removeTrackFromPlaylist(7, 2);
    const options = (fetch as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(JSON.parse(options.body as string).playlist.tracks).toEqual([
      { urn: "soundcloud:tracks:1" },
      { urn: "soundcloud:tracks:3" },
    ]);
  });
});
