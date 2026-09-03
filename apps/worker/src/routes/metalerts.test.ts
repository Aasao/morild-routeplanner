import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMetAlerts } from "./metalerts.js";
import type { Env } from "../env.js";

/**
 * Minimal fake av Cloudflare sin Cache API — nok til å bevise at
 * `handleMetAlerts` (a) lagrer ETag/Last-Modified i en bokføringsoppføring
 * som overlever at serveringsoppføringen er borte (TTL utløpt), (b) sender
 * betinget forespørsel ved fornyelse, og (c) beholder cachet kropp på 304.
 * Vitest kjører uten `@cloudflare/vitest-pool-workers` her, så det finnes
 * ingen ekte `caches`-global å teste mot — se review-funn 2026-09-03.
 */
function createFakeCache() {
  const store = new Map<string, Response>();
  return {
    match: vi.fn(async (req: Request) => {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    }),
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(req.url, res.clone());
    }),
    store,
  };
}

function createEnv(): Env {
  return { DATA_BUCKET: {} as unknown as Env["DATA_BUCKET"] };
}

function createCtx(): ExecutionContext & { readonly settled: Promise<unknown> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
    props: {},
    get settled() {
      return Promise.all(pending);
    },
  } as unknown as ExecutionContext & { readonly settled: Promise<unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleMetAlerts — betinget henting mot MET (200-vei)", () => {
  it("cacher både serveringskopi og en bokføringsoppføring med ETag/Last-Modified", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"features":[]}', {
        status: 200,
        headers: {
          etag: '"v1"',
          "last-modified": "Wed, 03 Sep 2026 08:00:00 GMT",
          "cache-control": "public, max-age=60",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ctx = createCtx();
    const response = await handleMetAlerts(
      new URL("https://worker.example/proxy/metalerts"),
      createEnv(),
      ctx,
    );
    await ctx.settled;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"features":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Første gang finnes ingen tidligere ETag å sende med.
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBeUndefined();

    const keys = [...cache.store.keys()];
    const recordKey = keys.find((k) => k.includes("__morild_revalidation_record"));
    const serveKey = keys.find((k) => !k.includes("__morild_revalidation_record"));
    expect(recordKey).toBeDefined();
    expect(serveKey).toBeDefined();

    const recordEntry = cache.store.get(recordKey!)!;
    expect(recordEntry.headers.get("etag")).toBe('"v1"');
    expect(recordEntry.headers.get("last-modified")).toBe("Wed, 03 Sep 2026 08:00:00 GMT");
  });
});

describe("handleMetAlerts — betinget henting mot MET (304-vei)", () => {
  it("sender If-None-Match/If-Modified-Since når serveringscachen er utløpt, og beholder cachet body på 304", async () => {
    const cache = createFakeCache();
    // Simulerer at serveringsoppføringen (cacheKey) har utløpt, men
    // bokføringsoppføringen (recordKey) fortsatt lever med forrige svar.
    const recordUrl = new URL("https://api.met.no/weatherapi/metalerts/2.0/current.json");
    recordUrl.searchParams.set("__morild_revalidation_record", "1");
    await cache.put(
      new Request(recordUrl.toString(), { method: "GET" }),
      new Response('{"features":["gammelt-varsel"]}', {
        status: 200,
        headers: {
          etag: '"v1"',
          "last-modified": "Wed, 03 Sep 2026 08:00:00 GMT",
          "cache-control": "public, max-age=2592000",
        },
      }),
    );
    vi.stubGlobal("caches", { default: cache });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { "cache-control": "public, max-age=90" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ctx = createCtx();
    const response = await handleMetAlerts(
      new URL("https://worker.example/proxy/metalerts"),
      createEnv(),
      ctx,
    );
    await ctx.settled;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentHeaders = init.headers as Record<string, string>;
    expect(sentHeaders["If-None-Match"]).toBe('"v1"');
    expect(sentHeaders["If-Modified-Since"]).toBe("Wed, 03 Sep 2026 08:00:00 GMT");

    // 304 har ingen kropp — klienten skal likevel få forrige innhold, ikke tom respons.
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"features":["gammelt-varsel"]}');
    expect(response.headers.get("cache-control")).toBe("public, max-age=90");

    // Serveringscachen skal være fornyet, slik at neste forespørsel treffer den direkte.
    const serveKey = new Request(
      "https://api.met.no/weatherapi/metalerts/2.0/current.json",
      { method: "GET" },
    ).url;
    const renewed = cache.store.get(serveKey);
    expect(renewed).toBeDefined();
    expect(await renewed!.clone().text()).toBe('{"features":["gammelt-varsel"]}');
  });
});
