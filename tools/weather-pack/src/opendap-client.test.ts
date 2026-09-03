import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BACKOFF,
  buildAllMembersDodsUrl,
  buildDodsUrl,
  buildIndexRangeQuery,
  buildUserAgent,
  emptyGridIndexCache,
  fetchWithBackoff,
  resolveIndexWindow,
  windowToDimRanges,
  type FetchLike,
} from "./opendap-client.js";

describe("buildIndexRangeQuery / buildDodsUrl", () => {
  it("bygger [start:stride:stop]-uttrykk i riktig rekkefølge (spike-mønster)", () => {
    const q = buildIndexRangeQuery("x_wind_10m", [
      { start: 0, stop: 61 },
      { start: 0, stop: 0 },
      { start: 0, stop: 29 },
      { start: 45, stop: 150 },
      { start: 10, stop: 115 },
    ]);
    expect(q).toBe("x_wind_10m[0:1:61][0:1:0][0:1:29][45:1:150][10:1:115]");
  });

  it("respekterer en eksplisitt stride", () => {
    const q = buildIndexRangeQuery("v", [{ start: 0, stop: 100, stride: 5 }]);
    expect(q).toBe("v[0:5:100]");
  });

  it("dods-URL matcher spikens verifiserte kommaunnslippsmønster", () => {
    const url = buildDodsUrl("https://thredds.met.no/thredds/dodsC/mepslatest/x", "x_wind_10m", [
      { start: 0, stop: 61 },
    ]);
    expect(url).toBe(
      "https://thredds.met.no/thredds/dodsC/mepslatest/x.dods?x_wind_10m%5B0%3A1%3A61%5D",
    );
  });
});

describe("buildAllMembersDodsUrl (§7 punkt 2 — alle 30 medlemmer i ETT kall)", () => {
  it("setter medlemsdimensjonen til [0:1:29] uansett input-vindu på den aksen", () => {
    const dims = [
      { start: 0, stop: 61 }, // time
      { start: 0, stop: 0 }, // height
      { start: 0, stop: 0 }, // member (skal overskrives)
      { start: 45, stop: 150 }, // y
      { start: 10, stop: 115 }, // x
    ];
    const url = buildAllMembersDodsUrl(
      "https://thredds.met.no/thredds/dodsC/mepslatest/x",
      "x_wind_10m",
      dims,
      2,
      30,
    );
    expect(decodeURIComponent(url)).toBe(
      "https://thredds.met.no/thredds/dodsC/mepslatest/x.dods?x_wind_10m[0:1:61][0:1:0][0:1:29][45:1:150][10:1:115]",
    );
  });
});

describe("windowToDimRanges", () => {
  it("konverterer grid.ts IndexWindow til y/x DimRange", () => {
    const result = windowToDimRanges({ yStart: 45, yEnd: 150, xStart: 10, xEnd: 115 });
    expect(result).toEqual({ y: { start: 45, stop: 150 }, x: { start: 10, stop: 115 } });
  });
});

describe("resolveIndexWindow (§7 punkt 1 — permanent cache, unngår re-oppslag)", () => {
  const bbox = { west: 9.0, south: 57.3, east: 11.5, north: 59.6 };

  it("kaller probe() ved cache-miss, og lagrer resultatet", async () => {
    const probe = vi.fn().mockResolvedValue({ yStart: 45, yEnd: 150, xStart: 10, xEnd: 115 });
    const result = await resolveIndexWindow(emptyGridIndexCache(), "meps-vind", bbox, probe);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.wasCached).toBe(false);
    expect(result.window).toEqual({ yStart: 45, yEnd: 150, xStart: 10, xEnd: 115 });
    expect(Object.keys(result.cache)).toHaveLength(1);
  });

  it("IKKE kaller probe() igjen ved cache-hit (spike-funn 7: unngå 17,75 MB re-oppslag)", async () => {
    const probe = vi.fn().mockResolvedValue({ yStart: 45, yEnd: 150, xStart: 10, xEnd: 115 });
    const first = await resolveIndexWindow(emptyGridIndexCache(), "meps-vind", bbox, probe);
    const second = await resolveIndexWindow(first.cache, "meps-vind", bbox, probe);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(second.wasCached).toBe(true);
    expect(second.window).toEqual(first.window);
  });

  it("ulik bbox eller datasett gir separate cache-oppføringer", async () => {
    const probe = vi.fn().mockResolvedValue({ yStart: 0, yEnd: 10, xStart: 0, xEnd: 10 });
    const first = await resolveIndexWindow(emptyGridIndexCache(), "meps-vind", bbox, probe);
    const second = await resolveIndexWindow(first.cache, "norkyst-strom", bbox, probe);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(Object.keys(second.cache)).toHaveLength(2);
  });
});

describe("buildUserAgent (§16 — obligatorisk, identifiserende UA)", () => {
  it("bygger UA-strengen i samme format som spiken/spec-en", () => {
    expect(buildUserAgent("0.1.0", "maasao@gmail.com")).toBe(
      "morild-routeplanner/0.1.0 maasao@gmail.com",
    );
  });
});

describe("fetchWithBackoff (§16 — eksponentiell backoff, aldri umiddelbar retry)", () => {
  function fakeResponse(status: number) {
    return {
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: async () => new ArrayBuffer(4),
    };
  }

  it("returnerer umiddelbart ved 200 OK, uten forsinkelse", async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue(fakeResponse(200));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await fetchWithBackoff("https://x", "ua", fetchImpl, { ...DEFAULT_BACKOFF, sleep });
    expect(result.attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gir eksponentielt økende forsinkelse ved gjentatte 503 (THREDDS/NCSS-mønsteret)", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(503))
      .mockResolvedValueOnce(fakeResponse(503))
      .mockResolvedValueOnce(fakeResponse(200));
    const delays: number[] = [];
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      delays.push(ms);
    });
    const result = await fetchWithBackoff("https://x", "ua", fetchImpl, {
      ...DEFAULT_BACKOFF,
      baseDelayMs: 100,
      sleep,
    });
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([100, 200]); // 100*2^0, 100*2^1
  });

  it("respekterer taket på forsinkelsen", async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(429))
      .mockResolvedValueOnce(fakeResponse(429))
      .mockResolvedValueOnce(fakeResponse(429))
      .mockResolvedValueOnce(fakeResponse(200));
    const delays: number[] = [];
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      delays.push(ms);
    });
    await fetchWithBackoff("https://x", "ua", fetchImpl, {
      ...DEFAULT_BACKOFF,
      baseDelayMs: 1000,
      maxDelayMs: 1500,
      sleep,
    });
    expect(delays).toEqual([1000, 1500, 1500]);
  });

  it("kaster etter maxAttempts uten flere forsøk", async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue(fakeResponse(503));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      fetchWithBackoff("https://x", "ua", fetchImpl, { ...DEFAULT_BACKOFF, maxAttempts: 3, sleep }),
    ).rejects.toThrow(/etter 3 forsøk/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("kaster umiddelbart på ikke-retrybar status (f.eks. 404), uten backoff", async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue(fakeResponse(404));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(fetchWithBackoff("https://x", "ua", fetchImpl, { ...DEFAULT_BACKOFF, sleep })).rejects.toThrow(
      /404/,
    );
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
