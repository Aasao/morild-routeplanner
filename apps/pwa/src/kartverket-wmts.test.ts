import { describe, expect, it, vi } from "vitest";
import {
  kartverketTileUrl,
  KVWMTS_PROTOCOL,
  parseKvwmtsUrl,
  registerKartverketProtocol,
  tileMatrixId,
  type AddProtocolFn,
} from "./kartverket-wmts.js";

describe("tileMatrixId", () => {
  it("nullutfyller til to sifre for zoom 0-9 (bekreftet mot GetCapabilities)", () => {
    expect(tileMatrixId(0)).toBe("00");
    expect(tileMatrixId(9)).toBe("09");
  });

  it("lar zoom 10+ stå uten utfylling", () => {
    expect(tileMatrixId(10)).toBe("10");
    expect(tileMatrixId(18)).toBe("18");
  });
});

describe("parseKvwmtsUrl", () => {
  it("trekker ut z/x/y fra en MapLibre-substituert URL", () => {
    expect(parseKvwmtsUrl("kvwmts://tile/8/135/75")).toEqual({ z: 8, x: 135, y: 75 });
  });

  it("kaster på uventet form", () => {
    expect(() => parseKvwmtsUrl("https://example.com")).toThrow();
  });
});

describe("kartverketTileUrl", () => {
  it("bygger riktig KVP GetTile-URL (verifisert mot ekte Kartverket-respons 2026-09-03)", () => {
    const url = kartverketTileUrl({ z: 8, x: 135, y: 75 });
    expect(url).toContain("https://cache.kartverket.no/v1/service?");
    expect(url).toContain("service=WMTS");
    expect(url).toContain("request=GetTile");
    expect(url).toContain("layer=sjokartraster");
    expect(url).toContain("tilematrixset=webmercator");
    expect(url).toContain("tilematrix=08");
    expect(url).toContain("tilecol=135");
    expect(url).toContain("tilerow=75");
  });
});

describe("registerKartverketProtocol", () => {
  it("registrerer kvwmts-protokollen og oversetter til en ekte Kartverket-URL", async () => {
    let registeredName = "";
    let registeredHandler: Parameters<AddProtocolFn>[1] | undefined;
    const addProtocol: AddProtocolFn = (name, handler) => {
      registeredName = name;
      registeredHandler = handler;
    };

    registerKartverketProtocol(addProtocol);
    expect(registeredName).toBe(KVWMTS_PROTOCOL);
    expect(registeredHandler).toBeDefined();

    const fakeBuffer = new ArrayBuffer(4);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeBuffer),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await registeredHandler!({ url: "kvwmts://tile/8/135/75" }, new AbortController());
    expect(result.data).toBe(fakeBuffer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("tilematrix=08");

    vi.unstubAllGlobals();
  });
});
