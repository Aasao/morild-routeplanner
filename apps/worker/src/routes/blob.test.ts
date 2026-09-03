import { afterEach, describe, expect, it, vi } from "vitest";
import { handleBlob, isAllowedBlobKey } from "./blob.js";

describe("isAllowedBlobKey", () => {
  it("tillater nøkler under de kjente prefiksene", () => {
    expect(isAllowedBlobKey("weather/1/ab12cd.bin")).toBe(true);
    expect(isAllowedBlobKey("charts/1/deadbeef.pmtiles")).toBe(true);
  });

  it("avviser nøkler utenfor de kjente prefiksene", () => {
    expect(isAllowedBlobKey("pointer/vaer-skandinavia.json")).toBe(false);
    expect(isAllowedBlobKey("secrets/whatever")).toBe(false);
    expect(isAllowedBlobKey("")).toBe(false);
  });

  it("avviser forsøk på å bevege seg ut av prefikset med ..", () => {
    expect(isAllowedBlobKey("weather/../secrets/whatever")).toBe(false);
    expect(isAllowedBlobKey("weather/1/../../secrets")).toBe(false);
  });
});

/** Samme minimale fake som metalerts.test.ts bruker — se begrunnelsen der. */
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

function fakeR2Object(body: string, etag: string) {
  return {
    body: new Response(body).body,
    httpEtag: etag,
    writeHttpMetadata: (headers: Headers) => {
      headers.set("content-type", "application/octet-stream");
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleBlob — ADR-0006 strukturell grense", () => {
  it("gir 404 (ikke 400/data) for en nøkkel utenfor tillatte prefikser, identisk med et ekte miss", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const bucket = { get: vi.fn() };
    const ctx = createCtx();

    const response = await handleBlob(
      "routes/mine-hemmelige-turer.json",
      { MIRROR_BUCKET: bucket as never },
      new Request("https://worker.example/blob/routes/mine-hemmelige-turer.json"),
      ctx,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    // Bucketen kalles aldri for en strukturelt avvist nøkkel.
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("gir 404 for et ekte R2-miss under et tillatt prefiks", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const bucket = { get: vi.fn().mockResolvedValue(null) };
    const ctx = createCtx();

    const response = await handleBlob(
      "weather/1/finnes-ikke.bin",
      { MIRROR_BUCKET: bucket as never },
      new Request("https://worker.example/blob/weather/1/finnes-ikke.bin"),
      ctx,
    );

    expect(response.status).toBe(404);
  });
});

describe("handleBlob — edge-cache (review-funn)", () => {
  it("legger et treff i caches.default og betjener neste like forespørsel uten R2-oppslag", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const bucket = { get: vi.fn().mockResolvedValue(fakeR2Object("hei", '"abc"')) };
    const ctx = createCtx();
    const req = new Request("https://worker.example/blob/weather/1/ab12cd.bin");

    const first = await handleBlob("weather/1/ab12cd.bin", { MIRROR_BUCKET: bucket as never }, req, ctx);
    await ctx.settled;
    expect(first.status).toBe(200);
    expect(bucket.get).toHaveBeenCalledTimes(1);

    const second = await handleBlob("weather/1/ab12cd.bin", { MIRROR_BUCKET: bucket as never }, req, ctx);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("hei");
    // Andre treff kom fra edge-cachen, ikke et nytt R2-kall.
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });

  it("hopper over edge-cachen når klienten sender if-none-match (R2 er fasit for 304 vs 200)", async () => {
    const cache = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const bucket = { get: vi.fn().mockResolvedValue({ httpEtag: '"abc"' }) };
    const ctx = createCtx();
    const req = new Request("https://worker.example/blob/weather/1/ab12cd.bin", {
      headers: { "if-none-match": '"abc"' },
    });

    const response = await handleBlob("weather/1/ab12cd.bin", { MIRROR_BUCKET: bucket as never }, req, ctx);
    expect(response.status).toBe(304);
    expect(bucket.get).toHaveBeenCalledWith(
      "weather/1/ab12cd.bin",
      expect.objectContaining({ onlyIf: { etagDoesNotMatch: '"abc"' } }),
    );
  });
});
